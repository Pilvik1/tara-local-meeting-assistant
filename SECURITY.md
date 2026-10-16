# Security Policy

## Supported versions

Tara is beta software. Security fixes are applied to the newest published beta.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private
vulnerability-reporting or Security Advisory interface for this repository. If
that interface is unavailable, contact the maintainer privately through the
GitHub profile before sharing details.

Include the affected version, operating system, reproduction steps, impact, and
suggested mitigation. Never attach real recordings, transcripts, credentials,
model files, or meeting databases.

## Release security

- GitHub Actions are pinned to immutable commit SHAs.
- Pull-request workflows receive read-only repository permissions.
- The Windows gate builds and starts the frozen Python backend before packaging.
- Installer and portable executables ship with SHA-256 checksums and an SPDX SBOM.
- Production dependencies must have no known vulnerabilities.
- Development/build dependencies fail CI on high or critical advisories.

Windows beta binaries are initially unsigned and may trigger Microsoft Defender
SmartScreen. A checksum proves file identity, not publisher identity.

## Runtime boundaries

- The packaged backend binds to loopback by default.
- Packaged Electron generates a new high-entropy API token and instance identity
  on every launch; renderer requests receive the token through Electron's network
  layer and the backend rejects unauthenticated local requests.
- Electron context isolation and sandboxing are enabled; renderer Node.js access
  is disabled.
- New windows and untrusted navigation are denied by the desktop shell.
- Audio files are served only from Tara-controlled storage roots.
- Downloaded Qwen model weights and the bundled llama.cpp archive are verified
  against pinned SHA-256 values.
- Tara has no silent cloud-AI fallback.

## Known limitations

Tara does not encrypt its SQLite database or recordings and does not currently
ship signed executables or automatic updates. Treat the host account and disk as
part of the trusted computing boundary.
