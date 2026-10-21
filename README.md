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
- **Agent tools**: `list_files`, `list_media`, `read_file`, `write_file`, `edit_file`, `check`, `snapshot`, `read_docs`, `generate_voiceover`, `transcribe_and_caption`, `capture_website`, `generate_image`. Writes are confined to the project and to text files; media enters via the user's import, a website capture, or an image the user allowed Memotion to generate.
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
  - **Voiceover (TTS)**: Edge TTS (free, no key; unofficial Microsoft endpoint, so no SLA), OpenAI TTS, ElevenLabs, or an **offline Piper voice** (see below). Keys are entered in the tab and kept in the system keychain; OpenAI's is the same entry an OpenAI chat provider uses. Edge and ElevenLabs return word timings; OpenAI and the offline voice do not, so timings are measured with Whisper when it is already installed and *estimated* otherwise, and the UI says which.
  - **Captions**: four styles that really differ: `highlight` (the spoken word lights up), `pop` (words pop in as spoken), `classic` (phrase slides up, uppercase), `clean` (soft pill, sentence case). The scene is written to `compositions/captions.html` and mounted idempotently in `index.html` (one `<audio id="voiceover">`, one captions host at `z-index: 100`); regenerating replaces both. Portrait captions sit above the bottom UI band of Shorts/Reels.
  - **Captions from your own audio/video**: cloud Whisper when an OpenAI key exists, otherwise local whisper.cpp through `hyperframes transcribe`. That CLI would run `brew install whisper-cpp` by itself, which built cmake from source for 15 minutes here and left Homebrew half-linked, so Memotion always passes `--no-runtime-install`. With your consent in the UI it clones whisper.cpp and builds it in `~/.cache/hyperframes/whisper` (needs git, cmake, a C compiler; nothing outside that folder changes) and downloads the model (`small` by default, `small.en` for English). On Intel Macs whisper.cpp's GPU backend returned empty output for clear speech, so Memotion runs it on the CPU there (`-ng`) and retries once on CPU if a result contains no letters.
- **Variables tab**: edits variable defaults (`data-composition-variables`), updating text and colors in real-time.
- **Agent tools**: the AI director can also call `generate_voiceover({ text, voice, withCaptions })` and `transcribe_and_caption({ mediaPath })` directly when you ask in chat.
- **Offline voice (Piper)**: voices `News (Indonesian)` and `Lessac (US English)`, run by [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0) in a child `node -e` process. The official Piper macOS binary does not start (it references an `libespeak-ng` it does not ship), hence sherpa-onnx. First use asks consent, then downloads the engine from npm (about 37 MB, sha512 from the registry) and the voice (about 21 MB, pinned sha256) into `<data dir>/local-tts/`. Speech runs at about 2.5× real time on an Intel Mac. Word times are *estimated* inside the measured speech span unless whisper.cpp and its `base` model are already installed (Memotion never downloads them for this); measured against whisper on a 8 s sample, the estimate was off by 0.16 s on average and up to 0.37 s late in the sentence. Needs ffmpeg to make the mp3.

- Edits are written to the project's HTML by `hyperframes timeline move|trim|split|duplicate|delete`, which validates them (no overlap on a lane, nothing past the end of the video) and returns a receipt. Refusals are shown with the CLI's reason. Undo/redo replay those receipts (`.memotion/timeline-history.json`).
- Edits are blocked (HTTP 409) while the director is writing the same project.
- The Studio preview server notices file writes a few tens of ms late; a preview reloaded in that window stays stale. Every write path waits until its ETag changes (`withFreshPreview`) before the UI reloads.

## Templates, brand kits, formats, import (phase 3)

- **Templates** (sidebar: *Start from*, and the save icon on a project): a template is a copy of a project plus a thumbnail. Creating from it shows its variables (`data-composition-variables`) as a form and writes your values into the new project's defaults. `voiceover.mp3` and the transcript are not copied. Stored in `<data dir>/templates/`.
- **Brand kits** (Brand tab): colours, heading/body font, logo, tone. A kit can be built from a logo (palette picked from the image) or from a captured website. Applying it copies the logo to `assets/brand/` and fonts to `assets/fonts/` and tells the director the exact values to use. Kits live in `<data dir>/brand-kits/`, projects only hold copies.
- **Formats** (Brand tab): how the director structures a video. Built in: *Course module (16:9)*, *Short hook (9:16)*, *Product promo*. Your own are Markdown files in `<data dir>/formats/`; they cannot replace a built-in.
- **Import** (sidebar): a HyperFrames project is copied in (symlinks, `node_modules`, `.memotion`, `renders` skipped; size and file-count limits). A **Remotion** project is analysed first; features that cannot become a static HTML timeline (`useState`/`useReducer`, effects with dependencies, async `calculateMetadata`, UI libraries) are listed as blockers and stop the import unless you choose *Convert anyway*. The source goes to `import/remotion/` (read-only reference), assets to `assets/public/`, and the director gets a conversion prompt that is sent automatically. The conversion itself is done by the model, so its quality depends on the model and the project.

## Media sources

- **Website capture** (Sources tab, or ask the director): runs `hyperframes capture` and saves screenshots, images, colours, fonts and text under `assets/capture/<site>/`. Only public `http(s)` sites: private, loopback, link-local and metadata addresses are refused (host names are resolved first; image downloads refuse redirects). Limit: the capture browser runs inside the CLI, so a redirect or sub-request it makes after the first check is not re-checked. Text from the site is handed to the director as quoted data, never as instructions. From a capture you can create a brand kit or start a video.
- **AI images** (Sources tab, or ask the director): **off by default**, because every image costs money. Turn it on in Sources, then it needs a provider with the *images* capability and an image model (Settings). The `/images/generations` endpoint is called with the provider's key; the director may make at most 4 images per request; results are checked to be PNG/JPEG/WebP and saved under `assets/images/`.

## Coding agents on your computer (Claude Code, Codex, OpenCode)

Settings → *Director* lists the agent CLIs found on this computer and lets you pick who writes the video: an AI provider (API key), or one of them. Memotion finds them the way your terminal would: the process `PATH`, then your login shell's `PATH` (a program started from the Dock does not see nvm/fnm folders; `codex` installed with npm under nvm was only found this way), then the usual folders. It shows version and sign-in status (Claude Code and Codex report it; OpenCode's is not checked).

- **How a run works**: the CLI is started in the project folder, its stream (`stream-json` / `--json` / `--format json`) is turned into the same chat events as the API director, and the preview reloads while it works. Memotion's own tools reach it through an MCP server on the sidecar (`/mcp/<run token>`, valid only for that run): `check`, `snapshot`, `read_docs`, `list_media`, `generate_voiceover`, `transcribe_and_caption`, `capture_website`, `generate_image`. Its own file tools do the reading and writing.
- **Isolation** (each measured, not assumed): your personal hooks, plugins and MCP servers are *not* loaded. A broken personal Claude Code hook blocked every prompt in testing, and OpenCode called a personal MCP server and a personal skill until its config home was emptied and its Claude-skill discovery switched off. Claude Code runs with `--setting-sources project --strict-mcp-config`, no `Bash`/web tools; Codex with `-s workspace-write` (project folder only, no network) and `--ignore-user-config`; OpenCode with shell and web denied. The child gets none of Memotion's secrets (`MEMOTION_*` is removed from its environment). Cancel and quit stop the whole process group, not just the CLI (a helper it started otherwise kept the run hanging).
- **Verified for real**: each of the three was run on a small request (a title scene, then an edit) and finished with `check` passing through the MCP tool; Claude Code also applied a marked-element edit exactly (see below). **Antigravity** (`agy`) is detected but cannot be used: in print mode every file write was denied unless all permission prompts are disabled, which Memotion does not do.
- **Limits**: it uses your own subscription or quota for that tool. Each run starts fresh; the last six exchanges are put in front of your message for continuity, and the CLI re-reads the files. The chat shows the CLI's tool names, not Memotion's own wording. Codex's results for Memotion's MCP tools show only the tool name. Sign-in problems surface as the CLI's own error text.

## Preview tools: select, draw, comment

The toolbar under the preview has three tools. All of them tell the director *where* to change something; your message says *what*.

- **Select**: hover highlights the element under the pointer (with its `#id`), click selects it. It becomes a chip above the message box and goes to the director with its selector, text, source file, position and computed style. Fully transparent elements (e.g. a title before its fade-in) are skipped, because they receive clicks but nobody can see them.
- **Draw**: five pen colours, undo, clear, an optional note. *Attach to message* asks the page which elements lie under the pen, captures the frame (`hyperframes snapshot`, a few seconds), burns the strokes into it and attaches the PNG. A model that can see images gets the picture; a CLI agent gets its path.
- **Comment**: click a spot, type, Enter. Pins show near their time (or always while the comment tool is active); the *Comments* tab lists them. Open comments go with your next message (a chip with a ✕ turns that off) or all at once with *Send open comments*. Comments are stored per project in `.memotion/comments.json`; sent ones stay dimmed until you clear them.
- **How it works**: the preview frame is served by the sidecar (`/pv/<token>/<project>/...`) as a proxy of the Studio page. The proxy adds one script and rewrites the page's two absolute URLs; **your project files, and so your renders, never contain it**. The script answers "what is under this point" from the live DOM. Marks reach the model as a text block ("[The user marked the preview…]") plus the image, and the system prompt tells it to change only what the marks and the message refer to.
- **Verified for real**: select/comment/draw/send were driven in headless Chrome against a live sidecar (payload checked: selector, drawing path with the element under the pen, comment ids), the pick script has a real-browser test (opacity filter mutation-checked), and Claude Code received a selection plus an annotated frame and changed `font-size` and the accent colour of that element and nothing else.
- **Limits**: element picking is by point and reports the topmost visible element, so an element fully covered by another is not reported (a drawing samples up to 60 points along the strokes). In the headless test a seek sent right after the page loaded was lost and one sent 3 s later worked; the cause was not investigated, and I did not check whether the direct Studio embed behaves the same. Pins are stored with the project; the selection highlight is re-applied after a reload. The app targets Safari 15, so the preview code avoids `Promise.withResolvers`.

## Known limits

- Compositions load GSAP from a CDN (the HyperFrames blank template does), so previews and renders need internet unless a project vendors GSAP.
- One agent run per project at a time; chat history is per project (`.memotion/chat.json`).
- Splitting clones the element with a new id. GSAP tweens that target the original id (`#title`) do not apply to the new half, so animated text keeps its animation only on the first part; restyle the second part or ask the director to.
- No text editing on the timeline itself (use Variables or chat), no multi-select, and no drag between lanes.
- **The director was run for real with DeepSeek (`deepseek-chat`, no vision)** on one request: a 15 s 9:16 teaser with a brand kit and the *Short hook* format. The run produced a rendered 1080×1920 MP4 (30 and 60 fps, 15.000 s, 450/900 frames) and `check` passed. Three runs showed what to expect:
  - Run 1 never called `check`, and the loop had silently stopped at its 30-step cap. Fixed: the cap is now 60 and the user is told when it is hit; if the model wants to finish after changing files without running `check`, it is reminded once.
  - Run 1 also invented prices and opening hours. The prompt now forbids inventing facts (prices, hours, claims) and asks for marked placeholders; run 2–3 contained none.
  - Run 2 reused one scene file three times for three menu items; the video showed the first menu for the whole time and `check` still passed. The prompt now asks for one file per scene; run 3 showed all three menus.
  - **A model without vision cannot see its own output**, and `check` does not catch everything (clipped text in a pill, duplicated words, a repeated scene). Use a provider marked *vision* for work you cannot review yourself, and watch the preview. One request is not a quality benchmark: a different prompt or model can fail differently. One run also ended with "Connection error" (the machine's clock jumped around then; cause unproven); the history was saved and "continue" resumed it.
- Verified against the real thing: Edge TTS, local whisper.cpp transcription of real speech (Indonesian, `base` model, CPU), the offline Piper voice (install, speech, bundle build), `hyperframes capture` of a public page. **Not verified against the real services**: OpenAI TTS/Whisper/Images and ElevenLabs (mapping tested only against local mock servers; needs your keys), and the native file dialog / drag-and-drop in *Import* (the path field was tested).
- Offline voice was built and tested on macOS x64 only; the engine packages for macOS arm64, Linux and Windows x64 are mapped but untried. Kokoro is not included (Piper has an Indonesian voice; Kokoro does not).
- Website capture on `example.com` found no images (the CLI's asset catalogue was empty); heavier sites were not tried.
- The director may leave scratch files (`probe.html`, `notes`) in a project; it has no delete tool. They are not part of the video.
- A GUI-launched app may have a short `PATH`; ffmpeg is looked up in `/opt/homebrew/bin`, `/usr/local/bin` and `/usr/bin` for the offline voice, but rendering relies on the CLI finding ffmpeg itself.
- Live network tests are opt-in: `MEMOTION_LIVE_TESTS=1 pnpm test` runs the Edge TTS test, a real whisper transcription (needs whisper.cpp built and the `base` model), and a real offline-voice install and synthesis (downloads about 60 MB).
