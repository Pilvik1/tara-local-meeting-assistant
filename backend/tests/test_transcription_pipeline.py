from __future__ import annotations

import sys
import tempfile
import unittest
import json
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import BackgroundTasks

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import main  # noqa: E402


class TranscriptionPipelineTests(unittest.TestCase):
    def test_transcription_uses_fast_cpu_decode_profile(self) -> None:
        segment = SimpleNamespace(
            start=0.0,
            end=1.0,
            text="Clear sentence.",
            avg_logprob=-0.1,
            words=[],
        )
        info = SimpleNamespace(
            language="en",
            language_probability=0.99,
            duration=1.0,
            duration_after_vad=1.0,
        )
        model = SimpleNamespace(transcribe=lambda *_args, **_kwargs: (iter([segment]), info))

        with tempfile.NamedTemporaryFile(suffix=".wav") as audio:
            with patch.object(main, "get_whisper_model", return_value=model):
                lines, metadata = main._transcribe_source(
                    Path(audio.name),
                    "microphone",
                    "You",
                    {"model": "large-v3-turbo", "language": "en", "hotwords": []},
                )

        self.assertEqual(lines[0]["text"], "Clear sentence.")
        self.assertGreaterEqual(metadata["transcription_seconds"], 0)

        def capture_transcribe(*_args, **kwargs):
            self.assertEqual(kwargs["beam_size"], 1)
            self.assertFalse(kwargs["condition_on_previous_text"])
            self.assertTrue(kwargs["word_timestamps"])
            self.assertEqual(kwargs["language"], "en")
            return iter([segment]), info

        model.transcribe = capture_transcribe
        with tempfile.NamedTemporaryFile(suffix=".wav") as audio:
            with patch.object(main, "get_whisper_model", return_value=model):
                main._transcribe_source(
                    Path(audio.name),
                    "microphone",
                    "You",
                    {"model": "large-v3-turbo", "language": "en", "hotwords": []},
                )

    def test_separate_sources_are_transcribed_and_mixed_copy_is_ignored(self) -> None:
        def fake_transcribe(path: Path, source: str, speaker: str, _settings: dict):
            start = 2.0 if source == "microphone" else 1.0
            return (
                [{"speaker": speaker, "source": source, "start": start, "end": start + 1, "text": source}],
                {"source": source},
            )

        with patch.object(main, "_transcribe_source", side_effect=fake_transcribe) as transcribe:
            lines, metadata = main.transcribe_audio(
                None,
                {"microphone": "mic.webm", "system": "system.webm", "mixed": "mixed.webm"},
                [],
                {"model": "small", "language": "auto", "hotwords": []},
            )

        self.assertEqual([line["source"] for line in lines], ["system", "microphone"])
        self.assertEqual(lines[0]["speaker"], "Meeting audio")
        self.assertEqual(lines[1]["speaker"], "You")
        self.assertEqual(transcribe.call_count, 2)
        self.assertEqual([item["source"] for item in metadata["sources"]], ["microphone", "system"])

    def test_norwegian_basic_extraction_handles_actions_and_decisions(self) -> None:
        transcript = [
            {"speaker": "Møteleder", "start": 0, "end": 2, "text": "Vi besluttet å utsette lanseringen."},
            {"speaker": "Alex", "start": 3, "end": 5, "text": "Alex skal følge opp kunden før fredag."},
        ]
        result = main.heuristic_intelligence(transcript, [], "general")
        self.assertTrue(result["decisions"])
        self.assertTrue(result["action_items"])
        self.assertIn("lanseringen", [topic.lower() for topic in result["topics"]])

    def test_basic_extraction_abstains_on_casual_test_conversation(self) -> None:
        transcript = [
            {
                "speaker": "You",
                "start": 0,
                "end": 20,
                "text": (
                    "Jeg skal bare teste noen greier her. Jeg vet du har ting du må få gjort, "
                    "så jeg skal ikke bruke så lang tid. Det er ikke noe stress."
                ),
            },
            {
                "speaker": "Meeting audio",
                "start": 21,
                "end": 30,
                "text": "Jeg måtte bare sjekke et Excel-ark og vise deg noe jeg syntes var kult.",
            },
        ]

        result = main.heuristic_intelligence(transcript, [], "general")

        self.assertEqual(result["decisions"], [])
        self.assertEqual(result["action_items"], [])
        self.assertEqual(result["risks"], [])
        self.assertEqual(result["summary"]["key_discussion_points"], [])
        self.assertIn("No substantive decisions", result["summary"]["executive_summary"])

    def test_new_meeting_uses_saved_defaults_and_valid_insert_shape(self) -> None:
        original_db = main.DB_PATH
        with tempfile.TemporaryDirectory() as temp_dir:
            try:
                main.DB_PATH = Path(temp_dir) / "test.sqlite3"
                main.init_db()
                main.save_settings(
                    main.SettingsUpdate(
                        transcription_model="small",
                        transcription_language="no",
                        transcription_hotwords=["NHH", "Tara"],
                    )
                )
                meeting = main.create_meeting(main.MeetingCreate(title="Innstillingsmøte"), BackgroundTasks())
                self.assertEqual(
                    meeting["transcription_settings"],
                    {"model": "small", "language": "no", "hotwords": ["NHH", "Tara"]},
                )
                self.assertEqual(meeting["processing_status"], "queued")
            finally:
                main.DB_PATH = original_db

    def test_reanalysis_uses_saved_transcript_without_running_whisper(self) -> None:
        original_db = main.DB_PATH
        with tempfile.TemporaryDirectory() as temp_dir:
            try:
                main.DB_PATH = Path(temp_dir) / "test.sqlite3"
                main.init_db()
                meeting = main.create_meeting(
                    main.MeetingCreate(
                        title="Saved transcript",
                        notes=[main.Note(id="n1", timestamp=0, text="No explicit outcomes")],
                    ),
                    BackgroundTasks(),
                )
                transcript = [
                    {
                        "speaker": "You",
                        "start": 0,
                        "end": 3,
                        "text": "This was only a casual test.",
                    }
                ]
                with closing(main.connect()) as db:
                    db.execute(
                        "UPDATE meetings SET transcript = ?, processing_status = 'done' WHERE id = ?",
                        (json.dumps(transcript), meeting["id"]),
                    )
                    db.commit()

                with patch.object(main, "transcribe_audio") as transcribe:
                    main.reanalyze_meeting_content(meeting["id"])

                transcribe.assert_not_called()
                updated = main.get_meeting(meeting["id"])
                self.assertEqual(updated["processing_status"], "done")
                self.assertEqual(updated["analysis_source"], "basic")
                self.assertEqual(updated["action_items"], [])
                self.assertIn("No substantive decisions", updated["summary"]["executive_summary"])
            finally:
                main.DB_PATH = original_db


if __name__ == "__main__":
    unittest.main()
