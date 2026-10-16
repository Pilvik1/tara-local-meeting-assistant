# Roadmap

This roadmap communicates direction, not promised dates.

## Current beta line

- separate microphone and Windows loopback recordings;
- local Whisper-compatible transcription in Norwegian, English, mixed, or auto mode;
- local Qwen analysis through a pinned llama.cpp runtime;
- evidence validation and abstention for unsupported decisions, actions, and risks;
- searchable local meeting library, playback, retranscription, notes, Q&A, and export;
- installer and portable Windows builds with checksums and an SPDX SBOM.

## Before 1.0

- establish Windows code signing and trusted update delivery;
- add a documented backup-and-restore workflow;
- improve model-download progress, cancellation, resume, disk-space checks, and recovery;
- expand accessibility, keyboard navigation, and audio-device compatibility testing;
- complete independent trademark review for the Tara product identity;
- document a supported upgrade and data-migration policy.

## Later candidates

- speaker diarization and improved speaker naming;
- live transcription;
- better export templates and cross-meeting search;
- additional desktop platforms after capture and packaging are proven;
- explicit external text-model adapters using OS credential storage and visible
  processing provenance.

## Deliberate non-goals

- mandatory accounts, subscriptions, telemetry, or advertising;
- silent upload of recordings or transcripts;
- an unreviewed cloud fallback when local processing fails;
- claiming legal consent on the user's behalf.

Feature proposals should describe the user problem, privacy impact, maintenance
cost, model/data implications, and acceptance criteria.
