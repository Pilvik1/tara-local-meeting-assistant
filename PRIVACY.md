# Privacy

Tara is local-first meeting software. Its default recording, transcription,
analysis, search, and storage path runs on the user's computer.

## Data stored locally

The Windows desktop app stores the following under the current user's Tara
application-data directory:

- a SQLite meeting database;
- separate microphone and system-audio recordings;
- downloaded Whisper-compatible transcription models;
- the optional Qwen GGUF intelligence model and its license;
- diagnostic desktop logs.

Tara does not encrypt those files itself. Use operating-system full-disk
encryption and appropriate device access controls for sensitive meetings.

## Network activity

Tara has no telemetry, advertising, analytics, account service, cloud storage,
or required hosted-AI call. Network access occurs only for explicit functions:

1. first-use model downloads from the relevant model distribution host;
2. release downloads from GitHub;
3. optional SMTP delivery configured by the operator.

Model-download requests do not intentionally include meeting audio or transcript
content. SMTP delivery sends meeting text to the configured mail server and is
therefore not local-only. It is disabled unless the operator supplies SMTP
configuration.

## Recording boundaries

Windows loopback mode records all system audio during the capture, not only one
meeting application. Users must obtain any consent required by law, contract,
workplace policy, or meeting-platform rules before recording.

## Local services

The packaged desktop backend binds to `127.0.0.1`. Development operators can
change the host through environment configuration, but exposing Tara beyond the
loopback interface requires authentication, TLS, firewall controls, and an
independent threat review.

## Deletion and backups

Uninstalling Tara does not promise to delete user data. Back up the application
data directory while Tara is closed. Deleting that directory permanently removes
the local database, recordings, models, and logs; Tara has no cloud recovery copy.
