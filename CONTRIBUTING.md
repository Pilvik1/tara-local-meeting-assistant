# Contributing

Use an issue before substantial behavior, model, privacy, storage, or architecture
changes. Security reports belong in the private process described in
`SECURITY.md`.

## Development workflow

1. Branch from the current default branch.
2. Keep the change focused and never commit recordings, transcripts, databases,
   model weights, credentials, or personal meeting data.
3. Install dependencies using the commands in `README.md`.
4. Add tests for behavior changes.
5. Update privacy and architecture documentation when data flow changes.
6. Run `npm run check`, backend tests, and dependency audits.
7. Open a pull request using the repository template.

Windows capture, packaging, or backend-lifecycle changes must pass the frozen
runtime and restart-persistence gate in `.github/workflows/desktop-release.yml`.

Pull requests from forks run with read-only permissions and must not require
repository secrets.

## Developer Certificate of Origin

This project uses the Developer Certificate of Origin 1.1. Sign every commit with
`git commit -s` to certify that you may submit the contribution under the project
license. See <https://developercertificate.org/>.

## Style

- TypeScript/React: TypeScript, ESLint, and the existing component conventions.
- Python: clear standard-library-first code with deterministic tests.
- Prefer explicit data boundaries and failure states over hidden fallbacks.
- Do not add telemetry or hosted processing without an approved design that
  includes consent, credential storage, provenance, and documentation.

By participating, you agree to follow `CODE_OF_CONDUCT.md`.
