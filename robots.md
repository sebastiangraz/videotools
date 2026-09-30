# Video Tools

Browser video tools (Loop, Sequence, Speed, Convert, Mark) backed by ffmpeg, deployed on Vercel. This is the high-level guide; the code's comments carry the detail.

## Architecture

A Vite + React 19 client in `client/` (TanStack Router, one `/$tool` route per tool) and Vercel functions in `api/` (`upload.ts`, `process.ts`, `preview.ts`). Their private code lives in `api/_lib/` (the leading underscore keeps Vercel from deploying it as functions): `tools/` holds one module per tool, `encode/` one encoder per output format. `shared/` (formats, tool ids) is compiled by both sides. ffmpeg and gifski are real, pinned binaries: `npm install`'s postinstall fetches the host's builds listed in `ffmpeg.json` / `gifski.json` into `api/_bin/` (gitignored, sha256-checked); `vercel.json` ships the linux-x64 ones with the functions. There is no system ffmpeg dependency and no ffprobe (`ffmpeg -i` is the probe).

## Request flow

1. The browser uploads the file(s) straight to Vercel Blob (token from `/api/upload`), bypassing the function body limit.
2. It POSTs the tool id, blob URL(s) and options to `/api/process`, which downloads the inputs to a temp dir, runs the tool (one ffmpeg pass, plus gifski for GIF), uploads the result to Blob and returns its URL.
3. The browser downloads the result and asks `DELETE /api/process` to remove it. Input blobs are deleted by the function once it is done.

Stop (or leaving the tab) aborts the whole chain client-side; server-side a client disconnect aborts the job and kills ffmpeg (best effort). A hard kill skips cleanup, so every job ends with a sweep of stale blobs (uploads after 1 h, results after 24 h). `/api/preview` renders Mark's preview frames: the frame and logo come inline as data URLs, the same graph runs, and a JPEG comes back, with no Blob involved.

Handlers go through `allowMethods` and `runJob` (`api/_lib/request.ts`): an `InputError` becomes a 400 with its message and `code`, anything else a generic 500.

## Principles

- **A tool hands back the format it was given.** Loop, Speed and Mark return a GIF for a GIF, an MP4 for an MP4. Only Convert changes formats (Sequence asks for one because stills have none). A source is identified by content, not name, and one the app can't write (AVI, MKV, …) is refused with a pointer to Convert. The client does the same check on pick, before uploading.
- **One encoder per format**, shared by every tool. A tool describes its transformation (inputs + filtergraph); the format's encoder runs it in a single pass, so a result is encoded once.
- **Quality is relative to the source.** The quality slider is capped by what the source itself spends, so 100 means "match the source", not "maximum bytes".
- **Mark** takes video, animations and still images (PNG, JPEG, WebP). The logo can be a PNG or an SVG (SVG is rasterized via librsvg at the size the frame needs). There are two sizes, small and large, plus a `dev` size used only in debug mode, and three filters: plain, glass and blur.
- **Non-square-pixel (anamorphic) video is refused**, and the error message says how to re-export it.

## ffmpeg

One pinned ffmpeg (`ffmpeg.json`, currently 9.0.2), the same build locally and on Vercel, with no version workarounds in code. To upgrade: `npm run ffmpeg:mirror -- <version>` (publishes a release mirror and rewrites `ffmpeg.json`; needs `gh`), `npm install`, then `npm run smoke -- <label> --diff <previous label>`. The smoke diff is the gate. gifski is pinned the same way (see `api/_bin/gifski/README.md`).

## Adding a tool

1. Add its id to `TOOL_IDS` in `shared/tools.ts` (this also sets the tab order).
2. Add its entry to `TOOL_META` in `client/src/tools.ts` (label, description, input accept, action label).
3. Write the handler in `api/_lib/tools/<tool>.ts` and register it in `TOOLS` in `api/_lib/tools/index.ts`.
4. Add a page under `client/src/pages/<Tool>/` and register it in `PAGES` in `client/src/pages/index.ts`.
5. Add smoke cases to `CASES` in `scripts/smoke.mjs`.

Steps 1–4 are type-checked against each other, so a missing registration fails to compile. Routes, tabs and the SPA rewrite need no changes.

## Commands

Node 24 (`engines`). Setup: `npm install`, `vercel link`, connect a Blob store in the Vercel dashboard (`BLOB_READ_WRITE_TOKEN` is the only env var), `vercel env pull .env.local`.

```bash
npm run dev          # vercel dev: client + api on one origin
npm run lint         # eslint (lint:fix to fix)
npm run typecheck    # api/shared + client
npm test             # vitest (client tests + api/shared unit tests)
npm run smoke -- <label> [--diff <label>] [--only a,b] [--ffmpeg <path>] [--assets <dir>]
vercel               # preview deploy (vercel --prod for production)
```

Unit tests run through vitest from the client config (two projects: jsdom for `client/src`, node for `api/_tests` and `shared/`) and never spawn ffmpeg. `scripts/smoke.mjs` is the end-to-end gate: it runs every case through the real tool handlers and the pinned ffmpeg, checks each case's expectations (format, size ratio, frame count, rejections), and saves commands and results under `.smoke/<label>/` for `--diff`. A refactor should diff clean; a deliberate encoding change should show only the commands it meant to change.

Debug mode (dev only, never in a build): press Shift+D to toggle it. It sets `[data-debug]` on `<body>` and opens Mark's debug panel (preview views, the dev size). Dev servers also serve a `/test` scratch page for the shared components.

## Limits

- Uploads: 200 MB per file. Preview payload: 8 MB (frame + logo).
- Function time: `process` 300 s (encoders budget 240 s), `preview` 60 s, `upload` 30 s.
- GIF: at most 1500 frames or 384 M frame pixels. AVIF: at most 60 s or 648 M frame pixels. Convert caps animated-image width at 800 px.
- Reverse loop: decoded frames must fit in 1.2 GB (GIF is exempt). Crossfade streams.
- Sequence: 1–100 images, scaled to the first one, longest side at most 1920 px.
- Processing is synchronous: one request is held open for the whole job.
