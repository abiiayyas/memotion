# Changelog

## 0.1.3

- **Preview shortcuts & compact annotation toolbar:** `Space` plays/pauses from anywhere in the editor (when not typing in a field or inside a dialog); Select, Draw, and Comment tools move into the transport row with draw pen options displayed cleanly above it.
- **Look picker:** added per-video *Look* catalog picks (visual style, hook, story structure, and custom catalog shelves) on Home and in the Editor, and kept chat SSE streams alive while a coding agent CLI is silent.
- **Public repository release setup:** added `README.md`, `README.en.md`, `docs/screenshots/`, `docs/engineering/ARCHITECTURE.md`, `LICENSE` (MIT), `THIRD_PARTY_NOTICES.md`, `CONTRIBUTING.md`, `SECURITY.md`, issue templates, and GitHub Actions release builds for macOS (`.dmg`) and Windows (`.exe`).

## 0.1.2

- **Google Gemini TTS:** added `gemini-3.8-flash-tts` via the Interactions API (30 prebuilt voices and AI Studio voice IDs), ffmpeg `atempo` speed control, and estimated word-level caption timings.

## 0.1.1

- **Skills & prompt ideas:** install Markdown skills from a GitHub URL or local folder via Settings, attach them with the *Skill* chip, and surface clickable prompt ideas on Home.
- **Remotion import improvements:** added *Render as video instead* for Remotion projects with composition selection and cancellation support.
- **Project deletion & settings propagation:** safe two-step delete from the sidebar and All projects; director voiceover/captions honor Settings defaults.

## 0.1.0

- **Initial release:** Tauri 2 desktop shell + local Hono Node sidecar + HyperFrames `0.8.168` engine.
- **AI Director & local coding agents:** OpenAI-compatible API providers (keychain storage via `@napi-rs/keyring`) and isolated Claude Code, Codex, and OpenCode CLI runners over per-run MCP.
- **Visual timeline & preview tools:** multi-lane timeline with multi-select, marquee, atomic group edits, snap, zoom, and split; Select, Draw, and Comment preview tools; vision Reviewer; offline GSAP cache.
- **Voice, captions, brand kits & templates:** Edge TTS, offline Piper (`sherpa-onnx`), OpenAI TTS, ElevenLabs, Whisper/`whisper.cpp` transcription, 4 caption styles, brand kits, formats, templates, website capture, and AI image generation.
