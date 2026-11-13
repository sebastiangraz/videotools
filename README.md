Browser video tools: seamless loops, image sequences to video, speed changes, format conversion and watermarking. Built on ffmpeg.

## Installation

Bun 1.4. The WebAssembly ffmpeg and gifski are committed in `client/public/engine/`. The engine is cached by URL (immutable `Cache-Control`, Cache API), so a rebuild needs a new content-hashed folder for `GLUE_URL` (`client/src/engine/exec.ts`); `bun run test` reports the hash.

```bash
bun install                                     # deps
docker build -f wasm/Dockerfile --output client/public/engine/<new> wasm   # rebuild the engine
bun run dev                                     # Vite dev server

bun run test                                    # vitest (client tests + core and cli unit tests)
bun run lint                                    # oxlint (type-aware)
bun run format                                  # oxfmt
bun run typecheck                               # core + cli + client

bun run smoke name                              # outputs .smoke/name/
bun run smoke name mark                         # outputs .smoke/name/mark · [mark|light|quality], several allowed
bun run smoke name mark:debug                   # outputs .smoke/name/mark/debug · [:debug|depthmap|glass], comma-separated

bun add -g vercel                               # Vercel CLI
vercel --prod                                   # production deploy

git config core.autocrlf false                  # Windows: keep LF checkouts (oxfmt writes LF)
```

Unit tests never spawn ffmpeg. The smoke suites (`scripts/smoke/`) run the tools natively over `scripts/smoke/assets/`: `mark` and `light` render grids of marked clips for visual review; `quality` scores every tool's results (SSIM, PSNR, VMAF) against the floors in `quality.mjs`.

## Architecture

A Vite + React 19 static site in `client/` (TanStack Router, a single `/$tool` route): no backend, and nothing leaves the browser. The tools live in `core/` (`@videotools/core`): one module per tool in `tools/`, one encoder per format in `encode/`. They use `node:fs/promises` and `node:path`, with the command runner and resvg's WebAssembly injected, so the same code runs:

- In the browser, where Vite aliases those two modules to an in-memory filesystem (`client/src/engine/`), a job runs in a worker and each command in a fresh WebAssembly instance. ffmpeg's threads share memory, hence the COOP and COEP headers (`vercel.json`, `client/vite.config.ts`).
- Natively, for the CLI, smoke suites and scripts: `cli/exec.ts` spawns the binaries, downloaded on first use into `~/.videotools/<tool>-<version>/`, sha256-checked.
- On one pinned ffmpeg, built twice from the same tag with no version workarounds: WebAssembly in `wasm/Dockerfile`, native in `BINARIES` (`cli/binaries.ts`); gifski likewise (`cli/gifski/README.md`). No system ffmpeg, no ffprobe.

## CLI

`videotools` (`cli/index.ts`, npm `@videotools/cli`) runs the tools natively over many files: a job per file, or one for all of a sequence's images.

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

Flags are the page's controls and defaults; anything the page wouldn't offer is refused, except a `--start` past the clip's end, which the tool clamps. A folder means the files in it the tool takes (not subfolders); globs are expanded by the CLI. Files are deduplicated and sorted naturally by path, but a sequence takes its images in the order given, of one format, and is named after the first. Results are named as the app's downloads, verbose ones with `--verbose-names`, and go to `--out <dir>` (default: the current folder); a name collision fails the later file. A failed file doesn't stop the rest; the exit code is non-zero if any failed. Ctrl+C kills the running ffmpeg or gifski and removes the job's temp folder.

The app's Command line setting (off by default) shows each page's settings as an `npx @videotools/cli` command under its action button.

`bun run build` in `cli/` bundles it with core into `cli/dist/` for Node; resvg stays a dependency. To release, bump `version` in `cli/package.json` and push the tag `cli-v<version>`; `.github/workflows/cli.yml` tests, builds and publishes it.

## Principles

- **Format agnostic.** Loop, Speed and Mark return the format they're given and refuse formats the app doesn't write (AVI, MKV, etc.), pointing to Convert, the only tool that changes formats.
- **Single encoder**, shared by every tool: a tool describes inputs and a filtergraph, and the format's encoder renders them in one pass. A retry for a smaller file re-encodes the render, never the result.
- **Quality capped to source.** Quality 100 means "match the source", not "maximum bytes".
- **Non-square-pixel video is refused.** Anamorphic video is confusing, increasingly obsolete, and not this tool's job.
