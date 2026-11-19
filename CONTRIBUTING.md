# Contributing

Thanks for contributing to Memotion. Read the [English README](README.en.md)
(or [Indonesian README](README.md)) and review the technical notes in
[`docs/engineering/ARCHITECTURE.md`](docs/engineering/ARCHITECTURE.md). Core
architecture rules that must not be broken:

- **Secrets stay in the keychain:** API keys live in the OS keychain via
  `@napi-rs/keyring` (or `MEMOTION_API_KEY_<PROVIDER_ID>` env overrides for
  tests); never persist keys to disk in plain text and always strip `MEMOTION_*`
  environment variables before spawning CLI agent subprocesses.
- **Project-confined writes:** AI agent tools may only read/write text files
  inside the active project folder; media enters through user import, guarded
  website capture, or user-enabled image generation.
- **CLI agent isolation:** local coding agent CLIs (Claude Code, Codex,
  OpenCode) must run isolated from the user's personal hooks, plugins, shell
  tools, and unrelated MCP servers, communicating with Memotion only via the
  per-run MCP capability endpoint (`/mcp/<run token>`).
- **Clean preview proxy:** the sidecar preview proxy (`/pv/...`) injects DOM
  picking helpers at runtime only; project HTML files and exported renders must
  remain pure HyperFrames compositions.
- **No telemetry:** every `hyperframes` CLI subprocess runs via `cliEnv()` with
  telemetry, update checks, and skill auto-installs disabled.

## Development

Prerequisites: Node.js 22+, pnpm, Rust, and `ffmpeg` on `PATH` (macOS or Windows).

```bash
pnpm install
pnpm dev            # Tauri window with hot reload
pnpm typecheck      # must be clean across app and sidecar
pnpm test           # Vitest unit & integration suites
pnpm build          # build release app for the current platform
```

Keep development data separate from your real projects:

```bash
MEMOTION_DATA_DIR=/tmp/memotion-dev pnpm dev
```

## Pull requests

- Keep changes small and focused.
- Run `pnpm typecheck` and `pnpm test` before opening a PR; CI checks both
  along with the UI and sidecar bundle builds.
- Follow the style of the surrounding code. Comments explain *why*, not *what*.
- Add a `CHANGELOG.md` entry for user-visible changes.

## Licenses

The project's own code is licensed under the [MIT License](LICENSE).
Third-party components keep their own licences — see
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

By contributing, you agree to license your contributions under the project's
MIT license.
