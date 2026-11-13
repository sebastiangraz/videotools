Browser video tools: seamless loops, image sequences to video, speed changes, format conversion and watermarking. Built on ffmpeg.

## Installation

Bun 1.4. The WebAssembly builds of ffmpeg and gifski are committed in `client/public/engine/`, in a folder named after a hash of its files. Browsers cache them by URL, through an immutable `Cache-Control` header (`vercel.json`) and the Cache API. A rebuild therefore goes into a new folder, and `GLUE_URL` in `client/src/engine/exec.ts` must point to it. If the folder name doesn't match the hash, `bun run test` fails and shows the expected name.

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

Unit tests never spawn ffmpeg. The smoke suites in `scripts/smoke/` run the tools natively on the files in `scripts/smoke/assets/`. `mark` and `light` render grids of marked clips for visual review. `quality` scores every tool's results with SSIM, PSNR and VMAF, and fails if a score falls below the minimums in `quality.mjs`.

## Architecture

The client is a Vite + React 19 static site in `client/`, using TanStack Router with a single `/$tool` route. There is no backend, and files never leave the browser.

The tools live in `core/` (`@videotools/core`), with one module per tool in `tools/` and one encoder per output format in `encode/`. They use `node:fs/promises` and `node:path`, and receive the command runner and resvg's WebAssembly as arguments. This lets the same code run in two places:

- **In the browser.** Vite aliases `node:fs/promises` and `node:path` to an in-memory filesystem in `client/src/engine/`. Each job runs in a Web Worker, and each command runs in a fresh WebAssembly instance. ffmpeg's threads use shared memory, which requires cross-origin isolation, so every response sends COOP and COEP headers (`vercel.json`, and `client/vite.config.ts` for the dev server).
- **Natively.** For the CLI, the smoke suites and scripts, `cli/exec.ts` spawns the binaries. They are downloaded on first use into `~/.videotools/<tool>-<version>-<hash>/` and verified by sha256.

Both run the same pinned ffmpeg, built from the same tag with no version workarounds in code: as WebAssembly by `wasm/Dockerfile`, and natively from the builds pinned in `BINARIES` in `cli/binaries.ts`. gifski is pinned the same way (see `cli/gifski/README.md`). No system ffmpeg is needed, and ffprobe isn't used.

## CLI

`videotools` (`cli/index.ts`, published on npm as `@videotools/cli`) runs the tools natively over many files. It runs one job per file, or a single job for all of a sequence's images.

```bash
videotools LOOP <file|folder|glob>... [--technique <how>] [--fade <seconds>] [--start <seconds>] [--quality <n>]
videotools SEQUENCE <file|folder|glob>... [--frame-duration <seconds>] [--format <format>] [--quality <n>]
videotools SPEED <file|folder|glob>... [--speed <n>]
videotools CONVERT <file|folder|glob>... [--to <format>] [--quality <n>] [--fps <n>] [--width <px>]
videotools MARK <file|folder|glob>... --logo <png|svg> [--position <at>] [--size <size>] [--filter <filter>] [--shuffle] [--quality <n>]
videotools <TOOL> --help                        # flags, values and defaults
npx @videotools/cli <TOOL> ...                  # Node
bun cli/index.ts <TOOL> ...                     # repo
```

The command flags mirror the tool pages, and share the same defaults. Tools are in caps for legibility but any case works.

- **Inputs** can be files, folders or globs. A folder means the supported files directly inside it, not those in subfolders. The CLI expands globs itself, so they work in any shell.
- **Order.** Duplicates are removed and files are processed in natural sort order by path. Sequence is the exception: it keeps the order given, requires all images to be the same format, and names the result after the first image.
- **Output.** Written to `--out <dir>`, which defaults to the current directory. add `--verbose-names` to append abbreviated settings to the name, useful for comparing output without guesswork.
- **Failures.** If a file fails, the remaining files are still processed and the exit code is non-zero. Each job works in a folder of its own under `videotools-cli` in the system temp folder, deleted when the job ends. Ctrl+C stops the running ffmpeg or gifski process and deletes the job's folder.

Enabling `Command line` shows the equivalent `npx @videotools/cli` command on the tool page.

`bun run build` in `cli/` bundles the CLI and core into a single Node script in `cli/dist/`. The bundle leaves `@resvg/resvg-wasm` external, as a regular dependency. To release, bump `version` in `cli/package.json` and push a `cli-v<version>` tag. `.github/workflows/cli.yml` then tests, builds and publishes the package to npm.

## Principles

- **Format agnostic.** Loop, Speed and Mark return the same format they're given, and refuse formats the app can't write (AVI, MKV, etc.) with a pointer to Convert. Only Convert changes formats.
- **Single encoder**, shared by every tool. A tool describes its inputs and a filtergraph, and the output format's encoder renders them in one pass. If an encoder retries for a smaller file, it re-encodes from the same render, so retries add no generation loss.
- **Quality capped to source.** Quality 100 means "match the source", not "maximum bytes".
- **Non-square-pixel video is refused.** Anamorphic video is confusing, increasingly obsolete, and out of scope for this tool.
