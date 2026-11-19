# Security Policy

## Supported versions

Only the latest release receives security updates. Older releases are not
supported.

## Reporting a vulnerability

Please do **not** open a public issue for security vulnerabilities.

Report them privately through GitHub's private security advisory on this
repository: **Security → Report a vulnerability**.

Include as much of the following as you can:

- affected version(s) and platform (macOS, Windows, Linux),
- a short description of the issue,
- steps to reproduce,
- the potential impact.

We aim to acknowledge reports promptly and publish a fix together with an
advisory.

## Scope

In scope: the Tauri desktop shell, the local Node sidecar HTTP/SSE server,
bearer-token and per-run MCP capability authentication, file-path/SSRF guards,
CLI agent isolation, and the build/release pipeline.

Out of scope (report to the respective provider instead): third-party services
and tools configured by the user — OpenAI, Anthropic, Google Gemini, DeepSeek,
xAI Grok, OpenRouter, ElevenLabs, local coding agent CLIs, and upstream
`hyperframes` / `whisper.cpp` / `sherpa-onnx`.

## Preferences

- Write in English or Indonesian.
- Prefer concise reproduction steps over destructive exploits where possible.
