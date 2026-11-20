### Browser video tools: seamless loops, image sequences to video, speed changes, format conversion and watermarking. Built on ffmpeg.

---

**Installation**

```bash
bun install                     # dependencies (Bun 1.4)
bun run dev                     # Vite dev server

bun run test                    # vitest (client tests + core and cli unit tests)
bun run lint                    # oxlint (type-aware)
bun run format                  # oxfmt
bun run typecheck               # core + cli + client

bun run smoke name              # → .smoke/name/
bun run smoke name mark         # → .smoke/name/mark · [mark|light|quality] multiple allowed
bun run smoke name mark:debug   # → .smoke/name/mark/debug · [:debug|depthmap|glass] comma-separated
bun run icons [tool...]         # header icons → client/src/icons/, from scripts/icons/<tool>.ts

bun add -g vercel               # Vercel CLI
vercel --prod                   # production deploy

# rebuild the engine
docker build -f wasm/Dockerfile --output client/public/engine/<new> wasm

git config core.autocrlf false  # Windows: keep LF checkouts (oxfmt writes LF)
```

---

**CLI**

Full [documentation here](https://www.npmjs.com/package/@videotools/cli). The CLI runs the tools natively, approximately 1.5-4x faster than [videotoo.ls](https://videotoo.ls/) and supports bulk processing.

```bash
npx @videotools/cli --help # get started page
npx @videotools/cli MARK <img.png|folder|glob> <options> --logo logo.svg

# After global install you can use `videotools` shorthand
npm install -g @videotools/cli
videotools MARK <img.png|folder|glob> <options> --logo logo.svg
```

- **Inputs** · Can be files, folders or globs. Contents of nested folders are ignored by default.
- **Order** · Duplicates are removed and files are processed in natural sort order by path.
- **Output** · Written to `--out <dir>`, which defaults to `.` and collisions get numbered: `dupe.mp4 -> dupe_1.mp4`.
- **Verbosity** · `--verbose-names` appends abbreviated settings to the output, to keep track of the applied settings.
- **Failures** · A failed file doesn't stop the rest, but the exit code is non-zero. Temp files are cleaned up.

`bun run build` in `cli/` bundles the CLI and core into one Node script in `cli/dist/`, leaving `@resvg/resvg-wasm` as an external dependency. To release, bump `version` in `cli/package.json`; once that reaches `main`, `.github/workflows/cli.yml` tests, builds, publishes to npm and tags the commit `cli-v<version>`.

---

**FAQ**

- **Why are my files coming out way larger than my input?** · To retain fidelity the app measures quality loss with techniques like PSNR and VMAF. These values take precedence over file sizes. This is to ensure the quality remains stable if you run the same video through multiple jobs.
- **How can I bulk process videos?** · Use the CLI and use a folder directory as input.
- **Is there an MCP?** · No, but if you prefer using natural language ask your agent to get aquainted with the CLI.
- **Why are non-square-pixel inputs refused?** · Anamorphic video formats are confusing, increasingly obsolete, and out of scope for this tool. Use Handbrake to convert them to square-pixel formats.

---

**Principles**

- **Format agnostic** · Loop, Speed and Mark return the same format they're given, and refuse formats the app can't write.
- **Simple & Extensible** · The web UI handles the one-off tasks, while the CLI does the heavy lifting for more advanced use cases.
- **Quality at any cost** · By default the quality output value is set to 100 to retain fidelity throughout multiple jobs, even if it means larger files.

---

**Architecture**

The client is a Vite + React 19 static site in `client/`, using TanStack Router with a single `/$tool` route. There is no backend, and files never leave the browser.

The tools live in `core/` (`@videotools/core`), with one module per tool in `tools/` and one encoder per output format in `encode/`. They use `node:fs/promises` and `node:path`, and receive the command runner and resvg's WebAssembly as arguments. This lets the same code run in two places:

- **In the browser.** Vite aliases `node:fs/promises` and `node:path` to an in-memory filesystem in `client/src/engine/`. Each job runs in a Web Worker, and each command runs in a fresh WebAssembly instance. ffmpeg's threads use shared memory, which requires cross-origin isolation, so every response sends COOP and COEP headers (`vercel.json`, and `client/vite.config.ts` for the dev server).
- **Natively.** For the CLI, the smoke suites and scripts, `cli/exec.ts` spawns the binaries. They are downloaded on first use into `~/.videotools/<tool>-<version>-<hash>/` and verified by sha256.

Both run the same pinned ffmpeg, built from the same tag with no version workarounds in code: as WebAssembly by `wasm/Dockerfile`, and natively from the builds pinned in `BINARIES` in `cli/binaries.ts`. gifski is pinned the same way (see `cli/gifski/README.md`). No system ffmpeg is needed, and ffprobe isn't used.

The WebAssembly builds are committed in `client/public/engine/`, in a folder named after a hash of its files. Browsers cache them as immutable, so a rebuild goes into a new folder and `GLUE_URL` in `client/src/engine/exec.ts` must point to it. `bun run test` fails on a mismatch and shows the expected name.

Unit tests never spawn the binaries. The smoke suites in `scripts/smoke/` do, on the files in `scripts/smoke/assets/`: `mark` and `light` render grids of marked clips for visual review, and `quality` scores every tool's results with SSIM, PSNR and VMAF, failing below the minimums in `quality.mjs`.
