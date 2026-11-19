# Third-Party Notices

Memotion's own source code is licensed under [MIT](LICENSE). Third-party
software and models listed below retain their own licences.

This document distinguishes between what Memotion bundles inside the release
installer and what it uses on your computer or downloads at your request.

## Bundled in the application / installer

### HyperFrames

- Package: `hyperframes` (`0.8.168`)
- Source: <https://github.com/heygen-com/hyperframes>
- Licence: Apache License 2.0 (`Apache-2.0`)
- Purpose: Project structure, HTML/GSAP timeline operations, preview server, frame
  snapshots, website capture, transcription wrapper, and MP4 rendering.

### Tauri & Rust Crates

- Crates: `tauri`, `tauri-plugin-shell`, `tauri-plugin-dialog`,
  `tauri-plugin-opener`, `serde`, `serde_json`
- Licences: `Apache-2.0` / `MIT`

### Node.js Runtime & Key npm Packages

- **Node.js** (bundled as Tauri `externalBin` in release installers): MIT / Node.js
  license (<https://nodejs.org>).
- **`@napi-rs/keyring`**: MIT — native OS keychain integration for storing API keys.
- **`hono`**, **`@hono/node-server`**: MIT — local sidecar HTTP/SSE server.
- **`openai`**, **`zod`**, **`msedge-tts`**, **`react`**, **`react-dom`**: MIT.

For a complete inventory of npm and Cargo dependencies, inspect
`pnpm-lock.yaml` and `app/src-tauri/Cargo.lock`.

## System or on-demand software (not bundled)

These components are not stored in this repository and are either supplied by
your operating system or downloaded only when you use or consent to the feature:

### FFmpeg & FFprobe

- Source: <https://ffmpeg.org/legal.html>
- Licence: LGPL v2.1+ or GPL v2+/v3+ depending on the system build you install.
- Usage: Memotion invokes `ffmpeg` and `ffprobe` installed on your computer as
  separate subprocesses (for audio conversion, tempo adjustment, and HyperFrames
  video rendering).

### GSAP (GreenSock Animation Platform)

- Source & Licence: GreenSock Standard License — <https://gsap.com/standard-license>
- Usage: Cached locally in `<data dir>/vendor/gsap.min.js` on demand from
  jsDelivr (verified by SHA-256) so compositions preview and render offline.
  Anyone rendering compositions with GSAP is subject to the GreenSock Standard
  License.

### `whisper.cpp`

- Source: <https://github.com/ggml-org/whisper.cpp>
- Licence: MIT
- Usage: Built locally into HyperFrames' cache (`~/.cache/hyperframes/whisper`)
  only after user consent for local speech-to-text transcription.

### `sherpa-onnx` & Piper Voices

- Engine: `sherpa-onnx` (`1.13.8`, <https://github.com/k2-fsa/sherpa-onnx>) —
  Apache License 2.0 (`Apache-2.0`).
- Voices: Piper TTS models (`vits-piper-id_ID-news_tts-medium-int8`,
  `vits-piper-en_US-lessac-medium-int8`) downloaded from `sherpa-onnx` releases
  after explicit user consent; each voice retains its own upstream model
  licence.

### Chrome for Testing

- Usage: Downloaded on demand by the user from **Settings > Rendering** into
  HyperFrames' browser cache for headless frame rendering and snapshots.
