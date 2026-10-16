# Third-Party Notices

Tara includes and interoperates with open-source software and separately
downloaded model weights. Those components remain copyright their respective
owners and are governed by their own licenses.

Every GitHub release includes an SPDX JSON software bill of materials generated
from the exact tagged source. Package lockfiles and backend requirement files are
the reproducible dependency inputs.

## Notable runtime components

| Component | Role | License |
| --- | --- | --- |
| Electron / Chromium / Node.js | Desktop runtime | MIT and bundled third-party notices |
| React and TanStack Router / Query | Renderer | MIT |
| FastAPI, Uvicorn and Pydantic | Local API | MIT |
| faster-whisper | Local transcription orchestration | MIT |
| CTranslate2 | Whisper inference runtime | MIT |
| llama.cpp | Local GGUF inference runtime | MIT |
| Qwen3-4B-GGUF | Optional user-downloaded model weights | Apache-2.0 |
| PyInstaller | Frozen Python packaging | GPL-2.0-or-later with the PyInstaller bootloader exception |

Primary license references:

- Qwen3-4B-GGUF: <https://huggingface.co/Qwen/Qwen3-4B-GGUF>
- llama.cpp: <https://github.com/ggml-org/llama.cpp/blob/master/LICENSE>
- faster-whisper: <https://github.com/SYSTRAN/faster-whisper/blob/master/LICENSE>
- CTranslate2: <https://github.com/OpenNMT/CTranslate2/blob/master/LICENSE>
- PyInstaller: <https://pyinstaller.org/en/stable/license.html>

The Qwen model is not included in the source repository or Windows installer.
Tara downloads it only after an explicit user action, verifies its pinned SHA-256
digest, and attempts to store a copy of the model license beside the weight file.

Redistributors are responsible for preserving all applicable notices from the
release SBOM, packaged dependency metadata, and bundled runtime license files.
