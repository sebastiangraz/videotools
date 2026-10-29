Browser video tools: seamless loops, image sequences to video, speed changes, format conversion and watermarking. Built on ffmpeg, which runs on the visitor's own machine: the site is static, and its pages send their jobs to the videotools engine, a small local server the visitor installs once.

## Installation

Bun 1.4 is the package manager, script runner and the engine's runtime.

```bash
bun install                                         # deps + pinned ffmpeg/gifski (postinstall)
bun run engine                                      # the engine, from source
bun run dev                                         # the client (Vite), which talks to the engine

bun run test                                        # vitest (client tests + api unit tests)
bun run lint                                        # oxlint (type-aware on api/)
bun run format                                      # oxfmt
bun run typecheck                                   # api + client

                                                    # bun run smoke <name> [mark[:glass,debug,depthmap]|light|quality]
bun run smoke name                                  # run smoke test for name .smoke/name
bun run smoke name quality                          # run smoke test only for quality in .smoke/name/quality
bun run smoke name mark:debug                       # run debug view for mark smoke tests .smoke/name/mark/debug

bun run build:engine                                # compile the engine for each platform into dist/engine/
gh release upload engine dist/engine/* --clobber    # publish it where the install scripts fetch it (first time: gh release create engine dist/engine/*)
vercel --prod                                       # production deploy (the static client)

git config core.autocrlf false                      # Windows: keep LF checkouts (oxfmt writes LF)

curl.exe -s http://127.0.0.1:47823/health           # check engine version
```

Unit tests run through vitest from the client config (two projects: jsdom for `client/src`, node for `api/_tests`) and never spawn ffmpeg. `scripts/smoke/index.mjs` runs the smoke suites: the real tool handlers on the pinned ffmpeg, over the assets in `scripts/smoke/assets/` (`images/`, `vectors/`, and `videos/`, where each suite lists the clips it uses by file name). `mark` lays its videos out as cropped tiles of one grid and marks all tiles with each vector in turn into `.smoke/<name>/mark/mark.mp4` for a look at the glass over each backdrop. `light` lays out the light-tracking clips the same way, each marked whole with the first vector, into `.smoke/<name>/light/light.mp4` to watch the light follow each clip. `quality` runs each tool over its videos at quality 100 and scores each result's SSIM, PSNR and VMAF against a lossless render of the same pictures (or against its input where the tool copies), failing when any frame falls below the floors in `quality.mjs`; round trips are also scored against the source.

Debug mode press Shift+D to toggle it. It sets `[data-debug]` on `<body>` and opens Mark's debug panel (preview views, the dev size, a core gain knob). Dev servers also serve a `/test` scratch page for the shared components.

## Architecture

A Vite + React 19 client in `client/` (TanStack Router, one `/$tool` route per tool), deployed to Vercel as a static site, and the engine in `api/_lib/`: `serve.ts` is its server, `process.ts` and `preview.ts` its handlers, `tools/` holds one module per tool, `encode/` one encoder per output format. `_lib/formats.ts` (tool ids, formats, the engine's port and version) has no imports, so the client compiles it too. ffmpeg and gifski are real, pinned binaries (`BINARIES` in `_lib/binaries.ts`): `bun install`'s postinstall, and the engine when it starts, fetch the host's builds into `api/_bin/` under the working directory (gitignored, sha256-checked). There is no system ffmpeg dependency and no ffprobe (`ffmpeg -i` is the probe).

## The engine

`bun run build:engine` compiles `serve.ts` with Bun into one executable per platform, published as the `engine` release here. The compiled engine installs itself: opened from anywhere but `~/.videotools`, it stops the running engine (the pid from `/health`), moves into `~/.videotools`, makes itself start with the system (the user's Run key, a LaunchAgent; not on Linux), starts there and exits. When the site can't reach the engine it offers Windows visitors the executable to download and open (unsigned, so SmartScreen asks them to confirm), and macOS/Linux visitors the `scripts/install.sh` one-liner (`curl … | sh`), fetched from GitHub at the commit the deployment was built from (protected previews would answer with Vercel's login page). curl leaves no quarantine mark, so Gatekeeper doesn't stop the unsigned binary.

Settings shows the running engine's version and an Uninstall button, which sends `POST /uninstall`: the engine removes its Run key or LaunchAgent, `~/.videotools` (binaries, ffmpeg, gifski, the macOS log) and its temp folder, stops listening, answers and quits (a launchd-started one is booted out). Windows can't delete a running exe, so a hidden `cmd` deletes `~/.videotools` once the engine has quit. The site then offers the install again.

It listens on `127.0.0.1` only and refuses any page origin outside `ORIGINS` in `serve.ts` (production, this project's previews, localhost). Pages reach it with `targetAddressSpace: "loopback"`; Chrome asks the visitor once to allow access to apps on the device, Firefox allows it outright, and Safari blocks it, so the site tells Safari visitors to switch browsers. `/health` answers the engine's version; bump `ENGINE.version` in `formats.ts` when site and engine must update together, and the site asks visitors with an older engine to install it again.

## Request flow

1. The browser streams each file to the engine (`PUT /upload/<id>`, where the id is random plus the file's extension), which writes it to its temp folder.
2. It POSTs the tool id, upload ids and options to `/process`, which moves the inputs into a work dir, runs the tool (one ffmpeg pass, plus gifski for GIF), and answers with the result itself, named in `X-Filename`.
3. The browser saves the result. The engine deletes the inputs it was given and the result once sent.

Stop (or leaving the tab) aborts the whole chain client-side, and the disconnect fires `request.signal`, which kills ffmpeg; a failed run asks `DELETE /process` to drop its uploads. Whatever a crash leaves behind is cleared when the engine next starts. `/preview` renders Mark's preview frames: the frame and logo come inline as data URLs, the same graph runs, and a JPEG comes back.

Handlers are web-standard (`fetch(request)`, returning a `Response`) and go through `runJob` (`api/_lib/request.ts`): an `InputError` becomes a 400 with its message and `code`, anything else a generic 500.

## Principles

- **Format agnostic.** Loop, Speed and Mark return a GIF for a GIF, an MP4 for an MP4. Only Convert changes formats. Unsupported formats (AVI, MKV, etc.) are refused with a pointer to Convert.
- **Single encoder**, shared by every tool. A tool describes its transformation (inputs + filtergraph); the format's encoder runs it in a single pass, so a result is encoded once.
- **Quality capped to source.** The quality slider cranked to 100 means "match the source", not "maximum bytes" at any cost.
- **Refuse Non-square-pixel inputs**, anamorphic videos are confusing, increasingly obsolete, and this is not the tool to support them.

## ffmpeg

One pinned ffmpeg (currently 9.0.2, in `api/_lib/binaries.ts`), the same build in development and in every installed engine, with no version workarounds in code. Upgrades are rare and manual: gzip each platform's new build (BtbN GPL builds for Windows/Linux, martin-riedl.de for macOS), attach them to a new `ffmpeg-<version>` release here, update the URLs and binary sha256s in `BINARIES`, `bun install`, then `bun run test` and `bun run smoke <name>`. gifski is pinned the same way (see `api/_bin/gifski/README.md`).

## Adding a tool

1. Add its id to `TOOL_IDS` in `api/_lib/formats.ts` (this also sets the tab order).
2. Add its entry to `TOOL_META` in `client/src/tools.ts` (label, description, input accept, action label).
3. Write the handler in `api/_lib/tools/<tool>.ts` and register it in `TOOLS` in `api/_lib/tools/index.ts`.
4. Add a page under `client/src/pages/<Tool>/` and register it in `PAGES` in `client/src/pages/index.ts`.
5. Add a smoke suite in `scripts/smoke/` and register it in `SUITES` in `scripts/smoke/index.mjs`.

Steps 1–4 are type-checked against each other, so a missing registration fails to compile. Routes, tabs and the SPA rewrite need no changes.

## Limits

- Uploads: no size cap. Preview payload: 8 MB (frame + logo).
- Encoders stop optional size retries after 240 s.
- GIF: at most 1500 frames or 384 M frame pixels. AVIF: at most 60 s or 648 M frame pixels. Convert caps animated-image width at 800 px.
- Reverse loop: decoded frames must fit in 1.2 GB (GIF is exempt). Crossfade streams.
- Sequence: 1–100 images, scaled to the first one, longest side at most 1920 px.
- Processing is synchronous: one request is held open for the whole job.
