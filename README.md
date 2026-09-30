Browser video tools: seamless loops, image sequences to video, speed changes, format conversion and watermarking. Built on ffmpeg.

## Installation

Bun 1.4: package manager, script runner and the functions' runtime (`bunVersion` in `vercel.json`; keep `engines.node` out of `package.json`, it overrides that). The static linux ffmpeg (~164 MB) is over the Bun runtime's 150 MB function limit, so the project sets `VERCEL_SUPPORT_LARGE_FUNCTIONS=1` (Production and Preview). Setup: `bun install`, `vercel link`, connect a Blob store in the Vercel dashboard (`BLOB_READ_WRITE_TOKEN` is the only env var), `vercel env pull .env.local`.

```bash
git config core.autocrlf false  # Windows: keep LF checkouts (oxfmt writes LF)
bun install                  # deps + pinned ffmpeg/gifski (postinstall)
bun add -g vercel            # Vercel CLI
vercel link                  # link to the Vercel project (with a Blob store connected)
vercel env pull .env.local   # BLOB_READ_WRITE_TOKEN
bun run dev                  # vercel dev: client + api on one origin

bun run test                 # vitest (client tests + api/shared unit tests)
bun run lint                 # oxlint (type-aware on api/)
bun run format               # oxfmt
bun run typecheck            # api/shared + client
                             # e2e tests against the real ffmpeg
bun run smoke -- <label> [--diff <label>] [--only a,b] [--ffmpeg <path>] [--assets <dir>]
vercel --prod                # production deploy
```

Unit tests run through vitest from the client config (two projects: jsdom for `client/src`, node for `api/_tests` and `shared/`) and never spawn ffmpeg. `scripts/smoke.mjs` is the end-to-end gate: it runs every case through the real tool handlers and the pinned ffmpeg, checks each case's expectations (format, size ratio, frame count, rejections), and saves commands and results under `.smoke/<label>/` for `--diff`. A refactor should diff clean; a deliberate encoding change should show only the commands it meant to change.

Debug mode (dev only, never in a build): press Shift+D to toggle it. It sets `[data-debug]` on `<body>` and opens Mark's debug panel (preview views, the dev size). Dev servers also serve a `/test` scratch page for the shared components.

## Architecture

A Vite + React 19 client in `client/` (TanStack Router, one `/$tool` route per tool) and Vercel functions in `api/` (`upload.ts`, `process.ts`, `preview.ts`). Their private code lives in `api/_lib/` (the leading underscore keeps Vercel from deploying it as functions): `tools/` holds one module per tool, `encode/` one encoder per output format. `shared/` (formats, tool ids) is compiled by both sides. ffmpeg and gifski are real, pinned binaries: `bun install`'s postinstall fetches the host's builds pinned in `scripts/binaries.mjs` into `api/_bin/` (gitignored, sha256-checked); `vercel.json` ships the linux-x64 ones with the functions. There is no system ffmpeg dependency and no ffprobe (`ffmpeg -i` is the probe).

## Request flow

1. The browser uploads the file(s) straight to Vercel Blob (token from `/api/upload`), bypassing the function body limit.
2. It POSTs the tool id, blob URL(s) and options to `/api/process`, which downloads the inputs to a temp dir, runs the tool (one ffmpeg pass, plus gifski for GIF), uploads the result to Blob and returns its URL.
3. The browser downloads the result and asks `DELETE /api/process` to remove it. Input blobs are deleted by the function once it is done.

Stop (or leaving the tab) aborts the whole chain client-side; server-side a client disconnect fires `request.signal` (`supportsCancellation` in `vercel.json`), which kills ffmpeg: on Node; the Bun runtime does not support cancellation yet, so there a stopped job runs to the end. A hard kill skips cleanup, so every job ends with a sweep of stale blobs (uploads after 1 h, results after 24 h). `/api/preview` renders Mark's preview frames: the frame and logo come inline as data URLs, the same graph runs, and a JPEG comes back, with no Blob involved.

Handlers are web-standard (`export default { fetch(request) }`, returning a `Response`) and go through `runJob` (`api/_lib/request.ts`): an `InputError` becomes a 400 with its message and `code`, anything else a generic 500.

## Principles

- **Format agnostic.** Loop, Speed and Mark return a GIF for a GIF, an MP4 for an MP4. Only Convert changes formats. Unsupported formats (AVI, MKV, etc.) are refused with a pointer to Convert.
- **Single encoder**, shared by every tool. A tool describes its transformation (inputs + filtergraph); the format's encoder runs it in a single pass, so a result is encoded once.
- **Quality capped to source.** The quality slider cranked to 100 means "match the source", not "maximum bytes" at any cost.
- **Refuse Non-square-pixel inputs**, anamorphic videos are confusing, increasingly obsolete, and this is not the tool to support them.

## ffmpeg

One pinned ffmpeg (currently 9.0.2, in `scripts/binaries.mjs`), the same build locally and on Vercel, with no version workarounds in code. Upgrades are rare and manual: gzip each platform's new build (BtbN GPL builds for Windows/Linux, martin-riedl.de for macOS), attach them to a new `ffmpeg-<version>` release here, update the URLs and binary sha256s in `BINARIES`, `bun install`, then `bun run smoke -- <label> --diff <previous label>`. The smoke diff is the gate. gifski is pinned the same way (see `api/_bin/gifski/README.md`).

## Adding a tool

1. Add its id to `TOOL_IDS` in `shared/tools.ts` (this also sets the tab order).
2. Add its entry to `TOOL_META` in `client/src/tools.ts` (label, description, input accept, action label).
3. Write the handler in `api/_lib/tools/<tool>.ts` and register it in `TOOLS` in `api/_lib/tools/index.ts`.
4. Add a page under `client/src/pages/<Tool>/` and register it in `PAGES` in `client/src/pages/index.ts`.
5. Add smoke cases to `CASES` in `scripts/smoke.mjs`.

Steps 1–4 are type-checked against each other, so a missing registration fails to compile. Routes, tabs and the SPA rewrite need no changes.

## Limits

- Uploads: 200 MB per file. Preview payload: 8 MB (frame + logo).
- Function time: `process` 300 s (encoders budget 240 s), `preview` 60 s, `upload` 30 s.
- GIF: at most 1500 frames or 384 M frame pixels. AVIF: at most 60 s or 648 M frame pixels. Convert caps animated-image width at 800 px.
- Reverse loop: decoded frames must fit in 1.2 GB (GIF is exempt). Crossfade streams.
- Sequence: 1–100 images, scaled to the first one, longest side at most 1920 px.
- Processing is synchronous: one request is held open for the whole job.
