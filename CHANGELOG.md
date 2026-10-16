# Changelog

Tara follows Semantic Versioning. Beta releases may contain breaking changes.

## [Unreleased]

## [0.4.1-beta.1] - 2026-10-16

### Added

- clean public-candidate repository history;
- AGPL-3.0-only license and separate project-identity policy;
- privacy, security, support, contribution, and third-party notice documentation;
- presentation screenshots using synthetic demo meetings;
- pinned CI, secret scanning, dependency audits, DCO, checksums, and SBOM release gates.

### Changed

- moved the Windows application ID to the repository-owned namespace;
- enabled Electron renderer sandboxing and denied untrusted navigation/windows;
- authenticated each packaged desktop session with a fresh local API token and
  verified backend instance identity;
- refreshed dependency locks to eliminate known high and critical build-chain findings.

### Provenance

The application source was exported from the accepted private Tara v0.4.0
snapshot. Private history, obsolete deployment material, personal iOS setup,
recovery notes, recordings, databases, model weights, tags, and releases were not
copied.
