# Memotion

Prompt-to-video desktop app. You describe a video; an AI agent writes an HTML/GSAP composition; the app previews it and renders MP4 (16:9 or 9:16, 30 or 60 fps). Rendering uses the open-source [HyperFrames](https://github.com/heygen-com/hyperframes) engine (Apache-2.0), pinned to `0.8.168`.

## Architecture

```
Tauri shell (Rust)  ──spawns──▶  Node sidecar (TypeScript, Hono on 127.0.0.1:<random>, bearer token)
     │                                │  agent loop → OpenAI-compatible LLM (tool calling, streaming)
React UI  ◀── HTTP + SSE ─────────────┤  hyperframes CLI: init / check / snapshot / render / preview
     │                                └  project files in ~/Library/Application Support/memotion/projects
     └── iframe ──▶ HyperFrames Studio server (one per open project) — runtime driven by postMessage
```

- **Providers**: any OpenAI-compatible endpoint (base URL + key + model). Presets: OpenAI, Anthropic, Gemini, DeepSeek, xAI Grok, OpenRouter, OpenCode Zen, Command Code, Custom. Keys live in the system keychain (`@napi-rs/keyring`); nothing is written to disk in plain text. `MEMOTION_API_KEY_<PROVIDER_ID>` overrides the keychain (CI, scripts).
- **Agent tools**: `list_files`, `list_media`, `read_file`, `write_file`, `edit_file`, `check`, `snapshot`, `read_docs`. Writes are confined to the project and to text files; media only enters via the user's import.
- **Snapshots** are shown to the model only if the provider is marked `vision`.
- **Telemetry**: every CLI child runs with `HYPERFRAMES_NO_TELEMETRY=1`, no update check, no skill install.

## Develop

Requires Node 22+, pnpm, Rust, ffmpeg on PATH, and a HyperFrames-supported Chrome (downloaded by the CLI on first use).

```bash
pnpm install
pnpm dev            # Tauri window; the Rust shell runs sidecar/src/index.ts with your Node
pnpm test           # sidecar unit + agent-loop integration tests
pnpm typecheck
```

UI without Tauri (no native file dialog or drag-drop): `pnpm dev:sidecar` prints nothing but the handshake line; run it with `MEMOTION_PORT=47891 MEMOTION_TOKEN=dev`, then open `http://127.0.0.1:1420/?sidecar=47891&token=dev`.

## Build a release app

```bash
pnpm build          # copies Node as a Tauri sidecar, bundles sidecar/ (~125 MB incl. hyperframes), tauri build
```

## Timeline & Audio editing (phases 2 & 3)

The app provides full visual timeline and audio/subtitle generation:
- **Timeline tab**: lists every timed clip, including scene files (`compositions/*.html`), `<audio>`, and `<div id="captions">`. Drag clips to move, drag edges to trim, click ruler to seek. `S` splits at playhead, `D` duplicates, `⌫` deletes, `⌘Z`/`⇧⌘Z` undo/redo. Length field sets total video duration.
- **Voice & Captions tab**:
  - **Voiceover (TTS)**: Edge TTS (free, no key; unofficial Microsoft endpoint, so no SLA), OpenAI TTS, or ElevenLabs. Keys are entered in the tab and kept in the system keychain; OpenAI's is the same entry an OpenAI chat provider uses. Edge and ElevenLabs return word timings; OpenAI does not, so Whisper listens to the result, and if that fails the timings are *estimated* and the UI says so.
  - **Captions**: four styles that really differ: `highlight` (the spoken word lights up), `pop` (words pop in as spoken), `classic` (phrase slides up, uppercase), `clean` (soft pill, sentence case). The scene is written to `compositions/captions.html` and mounted idempotently in `index.html` (one `<audio id="voiceover">`, one captions host at `z-index: 100`); regenerating replaces both. Portrait captions sit above the bottom UI band of Shorts/Reels.
  - **Captions from your own audio/video**: cloud Whisper when an OpenAI key exists, otherwise local whisper.cpp through `hyperframes transcribe`. That CLI runs `brew install whisper-cpp` by itself if it is missing, so Memotion passes `--no-runtime-install` and asks for consent in the UI first.
- **Variables tab**: edits variable defaults (`data-composition-variables`), updating text and colors in real-time.
- **Agent tools**: the AI director can also call `generate_voiceover({ text, voice, withCaptions })` and `transcribe_and_caption({ mediaPath })` directly when you ask in chat.

- Edits are written to the project's HTML by `hyperframes timeline move|trim|split|duplicate|delete`, which validates them (no overlap on a lane, nothing past the end of the video) and returns a receipt. Refusals are shown with the CLI's reason. Undo/redo replay those receipts (`.memotion/timeline-history.json`).
- Edits are blocked (HTTP 409) while the director is writing the same project.
- The Studio preview server notices file writes a few tens of ms late; a preview reloaded in that window stays stale. Every write path waits until its ETag changes (`withFreshPreview`) before the UI reloads.

## Known limits

- Compositions load GSAP from a CDN (the HyperFrames blank template does), so previews and renders need internet unless a project vendors GSAP.
- One agent run per project at a time; chat history is per project (`.memotion/chat.json`).
- Splitting clones the element with a new id. GSAP tweens that target the original id (`#title`) do not apply to the new half, so animated text keeps its animation only on the first part; restyle the second part or ask the director to.
- No text editing on the timeline itself (use Variables or chat), no multi-select, and no drag between lanes.
- Not verified with real speech: local whisper transcription (whisper-cpp is not installed on the dev machine), OpenAI TTS/Whisper and ElevenLabs against the real services (their mapping is tested against local mock servers only).
- Not built yet: local TTS (Piper/Kokoro), AI image generation, website capture, templates and brand kits, Remotion import.
- Live network tests are opt-in: `MEMOTION_LIVE_TESTS=1 pnpm test` runs the Edge TTS test.
