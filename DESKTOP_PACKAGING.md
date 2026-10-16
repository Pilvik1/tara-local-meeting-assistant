# Desktop Packaging

## Release contract

Tara's downloadable Windows package includes:

- the React renderer and hardened Electron shell;
- a standalone PyInstaller build of the FastAPI backend;
- faster-whisper, CTranslate2, and their runtime dependencies;
- a pinned, checksum-verified llama.cpp CPU runtime;
- license, privacy, and third-party notice files.

It deliberately excludes Whisper weights, the optional Qwen GGUF, recordings,
and user databases. Models are explicit post-install downloads and remain in the
user's local Tara data directory.

## CI release gate

The Windows workflow must prove all of the following before publishing:

1. Node production dependencies contain no known vulnerabilities.
2. The complete build dependency tree has no high or critical advisories.
3. Backend and renderer tests, type checking, linting, and production build pass.
4. PyInstaller produces a standalone backend.
5. The llama.cpp archive matches the pinned SHA-256 value.
6. The frozen backend starts and persists a meeting across restart.
7. Electron Builder creates both NSIS and portable executables.
8. SHA-256 checksums, a combined ZIP, and an SPDX SBOM are published.

Only version tags publish a GitHub release. Tags containing `-` are prereleases.

## Trust and support boundary

- Windows 10/11 is the supported release target.
- System-audio capture uses Electron's Windows loopback path and may capture all
  sounds played by the computer during the recording.
- Releases are not code-signed yet, so SmartScreen may warn.
- Automatic updates are not enabled.
- macOS and Linux remain development-only targets.

See [SECURITY.md](SECURITY.md) for vulnerability reporting and
[PRIVACY.md](PRIVACY.md) for data-flow details.
