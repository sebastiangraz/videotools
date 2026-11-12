Browser video tools: seamless loops, image sequences to video, speed changes, format conversion and watermarking. Built on ffmpeg.

## Installation

Bun 1.4: package manager and script runner. The app is a static site: every tool runs in the browser, on ffmpeg and gifski built as WebAssembly. That build is committed in `client/public/engine/`, in a folder named after its files that `GLUE_URL` (`client/src/engine/exec.ts`) points at: browsers keep an engine for good under its address. Rebuild it (`wasm/Dockerfile`, needs Docker) only when the engine changes, into a new folder that `GLUE_URL` then points at; `bun run test` gives the name to rename both to.

```bash
bun install                                     # deps
docker build -f wasm/Dockerfile --output client/public/engine/<new> wasm   # rebuild the engine
bun run dev                                     # Vite dev server

bun run test                                    # vitest (client tests + core unit tests)
bun run lint                                    # oxlint (type-aware on core/ and cli/)
bun run format                                  # oxfmt
bun run typecheck                               # core + cli + client

bun run smoke name                              # outputs .smoke/name/
bun run smoke name mark                         # outputs .smoke/name/mark · [mark|light|quality], several allowed
bun run smoke name mark:debug                   # outputs .smoke/name/mark/debug · [:debug|depthmap|glass], comma-separated

bun add -g vercel                               # Vercel CLI
vercel --prod                                   # production deploy

git config core.autocrlf false                  # Windows: keep LF checkouts (oxfmt writes LF)
```

Unit tests run through vitest from the client config (two projects: jsdom for `client/src`, node for `core/tests` and `cli/tests`) and never spawn ffmpeg. `scripts/smoke/index.mjs` runs the smoke suites: the tools themselves, natively on the pinned ffmpeg and gifski (downloaded into the user's cache on the first run), over the assets in `scripts/smoke/assets/` (`images/`, `vectors/`, and `videos/`, where each suite lists the clips it uses by file name). `mark` lays its videos out as cropped tiles of one grid and marks all tiles with each vector in turn into `.smoke/<name>/mark/mark.mp4` for a look at the glass over each backdrop. `light` lays out the light-tracking clips the same way, each marked whole with the first vector, into `.smoke/<name>/light/light.mp4` to watch the light follow each clip. `quality` runs each tool over its videos at quality 100 and scores each result's SSIM, PSNR and VMAF against a lossless render of the same pictures (or against its input where the tool copies), failing when any frame falls below the floors in `quality.mjs`; round trips are also scored against the source.

Debug mode press Shift+D to toggle it. It sets `[data-debug]` on `<body>` and opens Mark's debug panel (preview views, the dev size, a core gain knob). Dev servers also serve a `/test` scratch page for the shared components.

## Architecture

A Vite + React 19 client in `client/` (TanStack Router, one `/$tool` route per tool), deployed as a static site; there is no backend. The tools live in `core/`, a workspace package the client and `cli/` import as `@videotools/core/*`: `tools/` holds one module per tool, `encode/` one encoder per output format. They are written against `node:fs/promises`, `node:path`, and a command runner and resvg's WebAssembly they are handed, so the same code runs in two places:

- In the browser, where Vite swaps the two modules for the engine's in-memory ones (`client/src/engine/`) and a command runs ffmpeg or gifski as WebAssembly.
- Natively, for the CLI (below), the smoke suites and scripts, through `cli/` (the `@videotools/cli` package): `exec.ts` runs real binaries, and the first native run downloads the host's builds pinned in `binaries.ts` into the user's cache (`~/.videotools/<tool>-<version>/`), sha256-checked.

There is no system ffmpeg dependency and no ffprobe (`ffmpeg -i` is the probe).

## Run flow

Nothing leaves the browser.

1. The page hands the picked files and the options to `runEngine` (`client/src/engine/index.ts`), which starts a worker for the job. Jobs take turns: a browser grants a page only so many WebAssembly memories, each command takes one, and a worker returns them when it ends. A round of Mark previews is one job. The WebAssembly modules are compiled once per page and kept across visits by the Cache API.
2. The worker writes the files into the job's in-memory directory and runs the tool (one ffmpeg pass, plus gifski for GIF). Each command is a fresh WebAssembly instance, as each native run is a fresh process.
3. While the result is encoded, the worker posts how far it has got (ffmpeg's `-progress` frames against the result's length, gifski's frame count) for the action button's progress bar. Then it posts the result back and the page saves it as a download.

Cancel (or leaving the tab) terminates the worker. An `InputError` reaches the user with its message; anything else shows as a generic failure, with the detail in the console.

ffmpeg's threads share memory, which needs cross-origin isolation: every response carries the COOP and COEP headers (`vercel.json`, and a middleware in `client/vite.config.ts` for the dev server).

## CLI

`videotools` (`cli/index.ts`) runs the tools natively over many files, on the same code as the app, a job at a time: one per file, or one for all of a sequence's images.

```bash
videotools loop <file|folder|glob>... [--technique <how>] [--fade <seconds>] [--start <seconds>] [--quality <n>]
videotools sequence <file|folder|glob>... [--frame-duration <seconds>] [--format <format>] [--quality <n>]
videotools speed <file|folder|glob>... [--speed <n>]
videotools convert <file|folder|glob>... [--to <format>] [--quality <n>] [--fps <n>] [--width <px>]
videotools mark <file|folder|glob>... --logo <png|svg> [--position <at>] [--size <size>] [--filter <filter>] [--shuffle] [--quality <n>]
videotools <tool> --help                        # its flags, their values and defaults
npx @videotools/cli <tool> ...                  # from npm, on Node
bun cli/index.ts <tool> ...                     # from this repo
```

Every tool also takes `--out <dir>`. Mark's page copies its settings as an `npx @videotools/cli mark` command (Copy as command), naming the picked files or leaving placeholders to fill in, so a folder can be marked as the page marks one file.

`bun run build` in `cli/` bundles it, core included, into one Node script in `cli/dist/`; resvg's package stays a dependency, its WebAssembly read from where it is installed. To release, bump `version` in `cli/package.json` and push the tag `cli-v<version>`: `.github/workflows/cli.yml` tests, builds and publishes it to npm.

The flags are each page's controls: the page's values, starting where the page starts; any other value is refused, and so is a flag the page shows only beside another setting (`--fade` and `--start` with the crossfade technique, `--fps` and `--width` with GIF). Convert without `--to` picks as its page does: MP4, or WebM for an MP4. A negative `--speed` is written with `=`. `--shuffle` draws a new route for each file, as the page does for each export. A folder means the files in it that the tool takes, not its subfolders'; a glob is expanded by the CLI itself, for shells that pass it on as typed. Files go in natural filename order, except that a sequence takes its arguments in the order given (a folder's or glob's images in natural order) and is named after its first image; as on its page, its images must share a format. The first run downloads ffmpeg and gifski into the user's cache. Results go to `--out`, by default the current folder (never the sources', where a rerun would pick them up), named as the app names its downloads; a file whose result would take a name already written in the run fails instead. A failed file is reported (an `InputError` with its message) and the rest go on; the exit code says whether any failed. Ctrl+C stops the running ffmpeg or gifski and removes the job's temp folder.

## Principles

- **Format agnostic.** Loop, Speed and Mark return a GIF for a GIF, an MP4 for an MP4. Only Convert changes formats. Unsupported formats (AVI, MKV, etc.) are refused with a pointer to Convert.
- **Single encoder**, shared by every tool. A tool describes its transformation (inputs + filtergraph); the format's encoder runs it in a single pass, so a result is encoded once.
- **Quality capped to source.** The quality slider cranked to 100 means "match the source", not "maximum bytes" at any cost.
- **Refuse Non-square-pixel inputs**, anamorphic videos are confusing, increasingly obsolete, and this is not the tool to support them.

## ffmpeg

One pinned ffmpeg, built twice from the same tag with no version workarounds in code: as WebAssembly for the app (`wasm/Dockerfile`) and natively for the CLI, the smoke suites and scripts (`BINARIES` in `cli/binaries.ts`). Upgrades are rare and manual. Native: gzip each platform's new build (BtbN GPL builds for Windows/Linux, martin-riedl.de for macOS), attach them to a new `ffmpeg-<version>` release here, and update the version, URLs and binary sha256s in `BINARIES`; the next native run downloads the new build. WebAssembly: move the tag and library commits in `wasm/Dockerfile` and rebuild. Then `bun run test` and `bun run smoke <name>`. gifski is pinned the same way (see `cli/gifski/README.md`).

## Adding a tool

1. Add its id to `TOOL_IDS` in `core/formats.ts` (this also sets the tab order).
2. Add its entry to `TOOL_META` in `client/src/tools.ts` (label, description, input accept, action label).
3. Write the tool in `core/tools/<tool>.ts` and register it in `TOOLS` in `core/tools/index.ts`.
4. Add a page under `client/src/pages/<Tool>/` and register it in `PAGES` in `client/src/pages/index.ts`.
5. Add its command to `COMMANDS` in `cli/index.ts`: the page's controls as flags.
6. Add a smoke suite in `scripts/smoke/` and register it in `SUITES` in `scripts/smoke/index.mjs`.

Steps 1–5 are type-checked against each other, so a missing registration fails to compile. Routes, tabs and the SPA rewrite need no changes.

## Limits

- A run's inputs and result are held in memory, and its ffmpeg in a WebAssembly heap of fixed size. x264 gets as many threads as fit there beside what the tool's graph buffers, so large frames encode on fewer threads, and frames no thread count fits are refused.
- Encoders that try again for a better fit stop once a job has run long.
- GIF: at most 1500 frames or 384 M frame pixels. AVIF: at most 60 s or 648 M frame pixels. Convert caps animated-image width at 800 px.
- Reverse loop: decoded frames must fit in 1.2 GB (GIF is exempt). Crossfade streams.
- Sequence: 1–100 images, scaled to the first one, longest side at most 1920 px.
