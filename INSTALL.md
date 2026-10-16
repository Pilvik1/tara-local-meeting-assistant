# Install Tara

## Windows release

1. Open the repository's **Releases** page.
2. Download `Tara.Setup.<version>.exe` for the installer or
   `Tara.<version>.exe` for the portable build.
3. Compare the file's SHA-256 value with `SHA256SUMS.txt`.
4. Start Tara. Windows may show a SmartScreen warning because releases are not
   yet code-signed.

The release contains Electron, the local FastAPI backend, transcription
libraries, and a pinned llama.cpp runtime. Python and Node.js are not required.
Whisper weights and the optional Qwen model are downloaded only when needed.

## Development setup

Requirements: Node.js 24+, npm, and Python 3.11+.

```bash
npm ci
npm run backend:install
npm run check
npm run test:backend
npm run electron
```

Browser development mode is also available:

```bash
npm run dev
```

This starts the backend at `http://127.0.0.1:8765` and Vite at
`http://127.0.0.1:5173`.

## Local transcription settings

Tara defaults to CPU/int8 inference. The model, language, and private vocabulary
can be changed in the application. Developers can override the defaults:

```bash
export TARA_WHISPER_MODEL=small
export TARA_WHISPER_DEVICE=cpu
export TARA_WHISPER_COMPUTE_TYPE=int8
export TARA_WHISPER_LANGUAGE=auto
```

## Optional SMTP delivery

Email delivery is disabled unless SMTP is configured. Enabling it sends selected
meeting text to the configured mail server and therefore leaves the local trust
boundary.

```bash
export TARA_SMTP_HOST=smtp.example.com
export TARA_SMTP_PORT=587
export TARA_SMTP_TLS=true
export TARA_SMTP_FROM=tara@example.com
export TARA_SMTP_USERNAME=tara@example.com
export TARA_SMTP_PASSWORD=use-an-app-password
```

See [PRIVACY.md](PRIVACY.md) before enabling external delivery.

## Build a Windows package

The reproducible Windows release workflow is the supported packaging path. For
local development builds:

```bash
npm run pack
npm run dist
```

The package expects the frozen backend under `backend-dist/tara-backend` and the
pinned llama.cpp files under `local-runtime`; CI creates both before invoking
Electron Builder. See [DESKTOP_PACKAGING.md](DESKTOP_PACKAGING.md).
