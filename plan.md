# Plan: core/CLI split

Branch `cli`, created from `main` at `5b2bda19`. This file stays uncommitted.

## Open questions

Each has a recommendation; the phases below assume it. Answer before the phase named.

1. **resvg's wasm in a one-file CLI** (before phase 5). `api/_lib/svg.ts` finds it with `new URL("../../node_modules/@resvg/resvg-wasm/index_bg.wasm", import.meta.url)`. Phase 1 only shortens that to `../node_modules/…` (still relies on hoisting, as today). In a bundle the URL is relative to the bundle, so an SVG logo would fail. "One file" cannot literally hold a 2.4 MB wasm without inlining it.
   *Recommend:* `@resvg/resvg-wasm` becomes a real `dependency` of `video-tools` (same pin as core's), kept `--external` in the bundle; `svgToPng` takes the wasm from the host: the client passes Vite's asset URL, `cli/` reads the file via `import.meta.resolve("@resvg/resvg-wasm/index_bg.wasm")` (the package exports that path). Costs: the pin lives in two package.json files, and one more thing the host hands to core.
2. **Cache folder** (before phase 3). The brief says `local`'s `binaries.ts` downloads into `~/.videotools`. It does not: it installs into `api/_bin` under the cwd, or next to the compiled exe. `~/.videotools` is only where `serve.ts` copies the Windows exe.
   *Recommend:* `~/.videotools/<tool>-<version>/<binary>`, so an upgrade never meets a stale file.
3. **Windows gifski pin** (before phase 3). `main` pins `gifski-win32-x64.gz` (`9da8553c…`), which needs the VC++ runtime. `local` pins `gifski-win32-x64-hybrid.gz` (`92848333…`, static vcruntime). A public CLI on a clean Windows machine needs the hybrid one.
   *Recommend:* take `local`'s pin and its comment in phase 3; its output is checked by the one smoke run at the end.
4. **Tools do not reject bad options.** The brief says tools validate `options` themselves. They coerce: `--position bottm-right` silently becomes `bottom-right` (`markLook`), quality is clamped. For a public CLI a typo should fail.
   *Recommend:* the CLI rejects a value outside the UI's list, using core's own tables (`MARK_POSITIONS`, `MARK_FILTERS`, sizes without `dev`); no second copy of the lists.
5. **Mark's real UI options** (before phase 4). `Mark.tsx` sends `filter`, `size`, `position`, `route`, `quality`, `tuning`. Beyond the brief's list: **Shuffle** (`route`, built by `shuffleRoute` in `client/src/pages/Mark/useMarkPreview.ts`). `dev` size and `view` are debug-only.
   *Recommend:* add `--shuffle` and move `shuffleRoute` into `core/tools/mark-config.ts` (pure; the client imports it from there). Leave out `dev`, `view`, `tuning`.
6. **Quality default** (before phase 4). The UI starts at 100; `mark` falls back to 90 when the option is absent.
   *Recommend:* the CLI sends 100 when `--quality` is absent, so a bare command matches a bare UI run.
7. **Which tools ship first** (before phase 4). The brief's example is `mark` only. The others need their own flag lists (Loop: technique, fade, start, quality; Speed: speed; Convert: target, quality, and fps/width for animated targets; Sequence: frame duration, format, quality, and many inputs to one output, so no per-file loop).
   *Recommend:* phase 4 ships `mark`; phase 6 adds the other four before the first publish.
8. **`--out` default** (before phase 4). *Recommend:* the current directory, never the source folder: a rerun over `clips/` would pick up `*_marked.mp4` as inputs.
9. **gifski's LICENSE/README** are tracked in `api/_bin/gifski/` and describe the postinstall. *Recommend:* move them to `cli/gifski/`, rewrite the README for the cache download, and ship both in the npm package (`files`).
10. **First publish.** npm trusted publishing is configured per package on npmjs.com, which may require the package to exist first. Both are the user's manual steps (accounts are out of scope); phase 5's agent checks the current npm docs and writes the exact steps into its report, not into the repo.

Corrections to the brief that need no decision:
- `runTool` is at `scripts/smoke/index.mjs:59-67` and uses sync fs; it closes over one shared `ff`.
- `local`'s spawn runner is the body of `FFmpeg.run`, tied to `this.signal`. On `main` the seam is `Exec`, so it is adapted into `cli/exec.ts`. `Exec` has no abort signal and does not need one: the CLI kills the children it tracks.
- Smoke sets `console.log = () => {}`, so `Running:` lines are never printed. They are captured with a preload (below), not by changing smoke.
- `Running:` lines can differ between two runs of the same code: retries stop once `ff.startedAt` is older than the time budget (`encode/render.ts`), and smoke shares one `ff`. Hence two baselines.
- `.claude/worktrees/` holds old checkouts with `api/` in them: exclude `.claude` from every leftover search.

## Smoke policy (user decision, 2026-11-12)

No smoke runs and no `Running:` diffs during the phases: they take too long and output quality is not expected to move. Smoke runs **once, at the very end** (see "Final check"), against the phase 0 baseline. A significant difference in scores is handled separately then. Per phase, the scripts are only checked to still start: `bun run smoke` with no arguments must print its usage (imports resolve), and where native runs changed, `bun scripts/ffmpeg-check.mjs` and `bun scripts/light-track.mjs <clip>`. Briefs must tell agents not to run the smoke suites.

## House rules (pasted into every brief at `{{HOUSE RULES}}`)

```
- Repo: C:\Users\Sebastian\development\videotools, branch `cli`. Windows 11, Bun 1.4, Node 25.
  Work in this checkout. Do not commit, stash, switch branches or touch other branches.
  Do not use external services or accounts (no publish, no deploy, no gh release).
- KISS. Scrutinise every line. No new files or functions for convenience: a file or
  function exists only if the task names it or it has more than one caller.
- Comments say why, briefly, in the style of the surrounding code. None that name
  assets, narrate the change or explain what was left out.
- Renames go all the way: no old name left in code, config, scripts, comments or docs.
- Native tooling only: Bun/Node as they are. No tsx, jiti, ts-node, no CLI framework,
  no new dependency unless the brief names it. Config as .ts, or none when defaults do.
- README describes behaviour; no tunable numbers in it.
- Unit tests (vitest, no ffmpeg spawned) over end-to-end ones.
- LF line endings. Format only the files you touched (`bunx oxfmt <files>`); a
  whole-repo `bun run format` rewrites plan.md and committed engine files.
- Do not run the smoke suites (`bun run smoke <name>`): they run once at the very end.
  `bun run smoke` with no arguments (prints usage) is the check that its imports resolve.
- `core/` must run in a browser: no node:child_process, no Bun APIs, no node: imports
  other than node:fs/promises and node:path (the client aliases those two).
- Leave plan.md alone. Anything in the brief that the code contradicts: stop and report
  it instead of deciding.
- Report back: every file changed (added/moved/deleted), every command run with its
  result (exit code, pass/fail counts, the failing output), and anything unexpected.
```

## Sub-agents (7 at most)

All: `subagent_type: "general-purpose"`, `model: "opus"`, `effort: "xhigh"`. More work for an agent goes through SendMessage.

| Agent | Phases | Notes |
|---|---|---|
| **A** mover | 1, 2 | knows the layout after the move |
| **B** native | 3, 5 | binaries, Exec, bundle, release workflow |
| **C** cli | 4, 6, 8 | the command, its flags, the jobs measurement |
| **D** client | 7 | Copy as command |
| R1 | reserve | a fresh-eyed read-only review of `cli/` before the first publish, if wanted |
| R2, R3 | reserve | replace an agent whose context is spent or that fails the same check twice |

Fixes always go back to the agent that did the work. Everything runs one agent at a time in the one checkout, except phases 7 and 8, which touch disjoint files and may run together. No worktrees are planned; if one is used, its brief must start with: "Run `git rev-parse HEAD` and `git rev-parse cli`; if they differ, stop and report."

After each phase the main session verifies, reports to the user, and waits for the user to ask for the commit before starting the next phase.

## Phase 0: baseline (main session, no agent)

1. `git status` clean on `cli`; `bun install`; `bun run typecheck && bun run lint && bun run test` pass.
2. Write the capture preload **outside the repo** (scratchpad), `capture-running.mjs`:
   ```js
   import fs from "node:fs";
   const log = (...args) => {
     const line = args.join(" ");
     if (line.startsWith("Running: ")) fs.appendFileSync(process.env.RUNNING_LOG, `${line}\n`);
   };
   Object.defineProperty(console, "log", { get: () => log, set: () => {} });
   ```
   (Checked: it survives smoke's `console.log = …`.)
3. Two baselines: `RUNNING_LOG=<scratch>/base1.log bun --preload <scratch>/capture-running.mjs scripts/smoke/index.mjs base1`, then the same for `base2`. Both must exit 0.
4. Normalise and compare (Bash tool):
   ```sh
   norm() { sed -E 's#\\#/#g; s#^Running: [^ ]*/(ffmpeg|gifski)(\.exe)? #Running: \1 #; s#/\.smoke/[^/]+/#/.smoke/L/#g' "$1" | sort; }
   diff <(norm base1.log) <(norm base2.log)
   ```
   Whatever differs here is timing noise (retry passes); note which cases, and discount exactly those later.

### Phase 0 results (2026-11-12, `5b2bda19`)
- typecheck, lint pass; tests 21 files, 261 passed.
- **Smoke exits 1 on `main`**: `mark` and `light` pass, `quality` reports the same 4 failures in both runs: `loop-reverse` on `paint` and `screen` (length drift), `convert-gif` and `convert-webp` on `mkv`. So "smoke passes" below means: exit 1 with exactly these 4 failures and no others.
- 6191 `Running:` lines per run. One differs between the two baselines: the second step of `quality/mov-and-back/video` (`-maxrate`/`-bufsize` follow the first step's output size). Discount that line only.
- In sed's `norm`, write the backslash class as `[\\]` (`s#[\\]#/#g`); `s#\\#/#g` fails in Git Bash.
- Logs and normalised copies (`base1.norm`, `base2.norm`) are in the planning session's scratchpad, and the outputs in `.smoke/base1/`; they are the reference for the final smoke run.
- Phase 1 as run: agent A's own `bun run smoke moved` gave the same 4 failures (120 ok). The main session's `Running:` diff was stopped by the user and not done.

## Phase 1: the move (agent A)

No behaviour change. `api/` disappears.

| From | To |
|---|---|
| `api/_lib/**` except `binaries.ts` | `core/**` (same tree: `core/ffmpeg.ts`, `core/tools/…`, `core/encode/…`) |
| `api/_tests/*.test.ts` | `core/tests/` |
| `api/_lib/binaries.ts` (`execBinary`) | `cli/exec.ts`, verbatim (replaced in phase 3) |
| `api/_bin/` (tracked gifski LICENSE, README; ignored binaries) | `cli/bin/` (interim; gone in phase 3) |
| `@api/*` tsconfig path | package `@videotools/core`, imported as `@videotools/core/<path>` |

New: `core/package.json` (`@videotools/core`, private, `type: module`, `exports: { "./*": "./*.ts" }`, owns `@resvg/resvg-wasm`). Root `workspaces: ["core", "client"]`; client depends on `@videotools/core: workspace:*`.

### Brief A1 (new agent)

```
Goal: move videotools' tool code out of the Vercel-era `api/` folder into a private
workspace package `core/`, with no behaviour change. When you finish there is no `api`
directory and no "api"/"_lib"/"_tests"/"_bin"/"@api" left in any name, alias, script,
comment or doc (the GitHub URL api.github.com in VersionLabel.tsx is not ours; leave it).

{{HOUSE RULES}}

Moves (use `git mv` so history follows):
- api/_lib/** except binaries.ts -> core/** keeping the subtree (core/ffmpeg.ts,
  core/tools/*, core/encode/*, ...).
- api/_tests/*.test.ts -> core/tests/. Their imports become "../<file>.js".
- api/_lib/binaries.ts -> cli/exec.ts, content unchanged except its import path and its
  comment. It uses node:child_process, so it cannot live in core. cli/ gets no
  package.json yet.
- api/_bin/ -> cli/bin/ (two tracked files under gifski/, plus the git-ignored binaries:
  move those on disk too, or re-run the install after updating the path).

New file core/package.json: name "@videotools/core", private, "type": "module",
"exports": { "./*": "./*.ts" }, dependencies { "@resvg/resvg-wasm": "2.6.2" }. No build
step, no scripts. Remove @resvg/resvg-wasm from the root package.json. Root workspaces
become ["core", "client"]. client/package.json gains "@videotools/core": "workspace:*".
Run `bun install` and keep the bun.lock change.

Then update every reference:
- client/tsconfig.json: drop the "@api/*" path; fix the comment above "types".
- client/src/**: "@api/x" -> "@videotools/core/x" (App.tsx, tools.ts, sourceFormat.ts,
  engine/exec.ts, engine/worker.ts, pages/Mark/*, pages/Sequence/Sequence.tsx), and the
  comments that say api/_lib (worker.ts, Loop.tsx, Speed.tsx, sourceFormat.ts).
- client/vite.config.ts: the comment on the aliases, and the "node" test project's
  include -> "../core/tests/**/*.test.ts". The two node: aliases must still apply to
  core's files in dev, build and the worker bundle, and still be off in tests.
- tsconfig.json (root): include ["core", "cli", "client/vite.config.ts"]; drop the
  exclude if nothing needs it.
- core/svg.ts: the wasm URL is relative to the file, which is now one level higher.
- core/formats.ts comment ("api registry").
- scripts/binaries.mjs (binaryPath -> cli/bin), scripts/binaries-install.mjs,
  scripts/ffmpeg-check.mjs, scripts/light-track.mjs, scripts/smoke/*.mjs: paths and
  comments. Scripts keep importing by relative path (../../core/ffmpeg.ts).
- .gitignore and .vercelignore: api/_bin -> cli/bin, api/_tests -> core/tests.
- cli/bin/gifski/README.md: paths.
- README.md: every api mention (commands' comments, the test paragraph, Architecture,
  Adding a tool).
- vercel.json needs no change; say so if you find otherwise.

Do not change: any ffmpeg argument, any tool logic, smoke's suites, the binaries pins,
the postinstall (it still runs, into cli/bin).

Verify, and report each result:
1. bun run typecheck, bun run lint, bun run test (same test count as before: note both).
2. bun run format:check.
3. bun run build: client/dist is produced and contains an emitted resvg .wasm asset.
4. bun run dev, load /mark in a browser if you can drive one, or at least confirm the
   dev server serves a core module with the node: aliases applied; otherwise say it was
   not checked.
5. `bun run smoke` with no arguments prints its usage (imports resolve).
6. Leftovers: `git grep -nIE "@api|api/_|_lib|_tests|_bin" -- . ":!bun.lock"
   ":!client/public"` prints nothing, and `git ls-files api` prints nothing.
```

### Main session checklist
- Read the whole diff. Moved files show as renames with only import-path/comment edits (`git diff -M --stat main`); no `.ts` under `core/` other than moved ones.
- `bun install` then `bun run typecheck`, `lint`, `test`, `format:check`, `build`.
- Vercel: no `api/` at the root (nothing for Vercel to turn into a function), `vercel.json` unchanged, `.vercelignore` names only paths that exist, `client/dist` built by `bun run build`. Start `bun --filter client preview` and run Mark once in the browser with an SVG logo (exercises the aliases, the worker and the resvg asset).
- Leftover grep from the brief, plus the README read top to bottom.
- Compare with the brief: nothing extra (no index files, no re-export barrels).

**Risks:** Vite treats the symlinked workspace package differently from an aliased folder (aliases not applied, wasm asset not emitted): caught by build + the browser run. Hoisting moves resvg: caught by the browser run with an SVG logo. **Rollback:** nothing is committed; `git restore -SW . && git clean -fd core cli` and move `cli/bin` binaries back, or re-run `bun install`.

## Phase 2: one runner (agent A, follow-up)

`runTool` moves from smoke into `core/tools/index.ts`, next to `TOOLS`.

### Message A2 (SendMessage to A)

```
Phase 1 is committed. Next, small: smoke's `runTool` (scripts/smoke/index.mjs) moves into
core/tools/index.ts so the coming CLI shares it.

- Signature: runTool(ff, tool, files, options, workDir) -> the tool's result. It makes
  workDir, wraps each path as a ToolInput ({ name: basename, save: copy to destPath })
  and calls TOOLS[tool]. Use node:fs/promises and node:path only (core runs in the
  browser; the client's fs has mkdir and copyFile). Typed; no new file.
- Smoke passes its shared `ff`: keep the suites' call shape (runTool(tool, files,
  options, workDir)) with a one-line closure in index.mjs, so mark.mjs and quality.mjs
  do not change.
- The house rules from the first brief still apply.

Verify and report: bun run typecheck, lint, test, format:check, build (the client bundle
must still build: runTool is unused there), `bun run smoke` with no arguments prints
its usage. Do not run the suites.
```

### Main session checklist
- Diff is confined to `core/tools/index.ts` and `scripts/smoke/index.mjs`.
- typecheck, lint, test, build; `bun run smoke` prints its usage. Read `runTool` against the old smoke one: same steps.

**Risk:** none beyond a typo; **rollback:** `git restore` the two files.

## Phase 3: native runtime in `cli/` (agent B)

Assumes questions 2, 3, 9. After it: no postinstall, no binaries in the repo, `scripts/binaries*.mjs` gone.

- `cli/package.json`: `video-tools`, `type: module`, version, `devDependencies: { "@videotools/core": "workspace:*" }`. No `bin`/build yet (phase 5). Root workspaces `["core", "client", "cli"]`.
- `cli/binaries.ts`: the pins (from `scripts/binaries.mjs`) and `install` (from `local`'s `api/_lib/binaries.ts`), into the user cache.
- `cli/exec.ts`: `execBinary` rewritten from `local`'s spawn runner as an `Exec`, plus the set of running children so the CLI can kill them.
- Smoke and scripts import both from `cli/`.

### Brief B1 (new agent)

```
Goal: give videotools' native ffmpeg/gifski runtime one home, `cli/`, shared by the
smoke scripts now and a published CLI next. Remove the postinstall download.

{{HOUSE RULES}}

Context: `core/` (private package @videotools/core, TypeScript source, no build) holds
the tools. It runs commands through an `Exec` (core/ffmpeg.ts): (command, args,
{ cwd, onLine }) => { code, stdout, stderr }; non-zero exits resolve, only a failed
start rejects. Today cli/exec.ts has `execBinary`, an execFile-based Exec with no
streaming; scripts/binaries.mjs pins the binaries and scripts/binaries-install.mjs
(root postinstall) downloads them into cli/bin/. A retired branch `local` has better
versions of both; read them with `git show local:api/_lib/binaries.ts` and
`git show local:api/_lib/ffmpeg.ts` (the `run` method at the end). Reuse that code;
do not rewrite it from scratch. Do not change the `local` branch.

Do:
1. cli/package.json: name "video-tools", "type": "module", "version": "0.1.0",
   devDependencies { "@videotools/core": "workspace:*" } (devDependency on purpose: a
   workspace:* in dependencies would be rewritten on publish to a version npm does not
   have). No bin, no build script yet. Add "cli" to the root workspaces; bun install.
2. cli/binaries.ts, from local's binaries.ts: BINARIES (pins), binaryPath(tool),
   install(tool). Changes from local's version:
   - binaries live in the user cache: <home>/.videotools/<tool>-<version>/<tool>[.exe]
     [QUESTION 2];
   - drop `compiled()`, FFMPEG_BIN, BIN_PLATFORM and the import.meta.main postinstall
     block;
   - install is silent when the binary is already there and its stamp matches, prints
     one line when it downloads, and throws (not warns) when the host platform has no
     pin;
   - keep: streaming download, gunzip, sha256 of the unpacked binary checked against the
     pin before the rename into place, the .partial name, chmod.
   - pins: ffmpeg as in scripts/binaries.mjs; gifski win32-x64 takes local's
     "hybrid" build and its comment [QUESTION 3].
3. cli/exec.ts: replace execBinary's body with local's spawn runner, shaped as an Exec:
   stdio ["ignore","pipe","pipe"], windowsHide, lines split on \r or \n from BOTH stdout
   and stderr handed to onLine (native gifski reports progress on stdout), full stdout
   and stderr returned. No AbortSignal: instead export the set of running children, so a
   caller can kill them on Ctrl+C. Keep the "Failed to start command" rejection.
4. Smoke and scripts use them: scripts/smoke/index.mjs, scripts/ffmpeg-check.mjs,
   scripts/light-track.mjs import BINARIES/binaryPath/install and execBinary from
   ../cli (relative .ts imports). Smoke installs both binaries before requireFfmpeg.
   Each script works out the repo root itself where it needs it.
5. Delete scripts/binaries.mjs, scripts/binaries-install.mjs, the root "postinstall"
   script, cli/bin/ (and its lines in .gitignore and .vercelignore).
   Move cli/bin/gifski/LICENSE and README.md to cli/gifski/ and rewrite the README for
   the new download [QUESTION 9].
6. README.md: Installation, Architecture and the ffmpeg section describe the new flow
   (first smoke run downloads into the user cache; upgrade steps point at
   cli/binaries.ts). No numbers that live in code.
7. A unit test only if it needs no network and no ffmpeg: the line splitter in exec.ts
   is the candidate, but only if it is testable without adding an export for the test's
   sake. Tests live in cli/tests/ and need "../cli/tests/**/*.test.ts" added to the
   "node" project in client/vite.config.ts.

Do not: add a postinstall, add flags or a bin, touch core/ beyond what typecheck forces
(report it if so), change any ffmpeg argument.

Verify, and report each result:
- bun run typecheck, lint, test, format:check, build.
- Empty the cache folder, run `bun scripts/ffmpeg-check.mjs`: it downloads once and
  verifies; run it again: no download line. Make gifski download the same way (e.g.
  `bun -e` calling install("gifski")) and run the cached gifski with --version.
- `bun run smoke` with no arguments prints its usage. Do not run the suites.
- Corrupt check: truncate the cached ffmpeg's stamp or binary and confirm the next run
  re-downloads rather than running it; then a wrong sha256 in a pin (temporarily) makes
  install throw and leaves no binary in place. Restore the pin.
- bun scripts/ffmpeg-check.mjs and bun scripts/light-track.mjs
  scripts/smoke/assets/videos/pair.mp4 both work.
- `git grep -nE "binaries\.mjs|binaries-install|postinstall|cli/bin"` prints nothing.
Report also: the exact cache paths created, and download size/time.
```

### Main session checklist
- Diff `cli/binaries.ts` against `git show local:api/_lib/binaries.ts` and `cli/exec.ts` against `local`'s `run`: reused, not rewritten; differences are the ones the brief lists.
- `bun install` prints no postinstall; typecheck, lint, test, build.
- `bun scripts/ffmpeg-check.mjs`, `bun scripts/light-track.mjs scripts/smoke/assets/videos/pair.mp4` and `bun run smoke` (usage) yourself.
- `git status`: no binaries tracked or untracked in the repo; `.vercelignore` names only existing paths.
- README read for hard numbers and stale paths.

**Risks:** the hybrid gifski differs in output (only the final smoke run would show it); a download failure now surfaces at first smoke run, not at install. **Rollback:** `git restore -SW . && git clean -fd cli scripts`, `bun install` (the old postinstall refetches into `cli/bin`).

## Phase 4: the `mark` command (agent C)

Assumes questions 4–8.

Interface:
```
video-tools mark <file|folder|glob>... --logo <png|svg>
    [--position <top-left|top|…|bottom-right>] [--size <small|medium|large>]
    [--filter <plain|glass|blur>] [--shuffle] [--quality <1-100>] [--out <dir>]
video-tools --help | --version
```
- Output: `<out>/<resultFile(source name, suffix, ext).name>`, the function the web worker already uses (`core/formats.ts`), so names match the app's downloads.
- One file at a time, each its own job: temp work folder, fresh `FFmpeg`, `runTool`, copy the result out, remove the folder. A failed file is reported and the run goes on; exit code 1 if any failed, 2 on usage errors, 130 on Ctrl+C.
- Where things live: `cli/index.ts` (parse, expand inputs, loop, progress, cleanup): the only new file, plus its test. Flag → option conversion is a table in that file. Nothing new in core except `shuffleRoute` moving in.

### Brief C1 (new agent)

```
Goal: the first command of videotools' CLI: `video-tools mark`, which watermarks many
files natively with the same tool code as the web app.

{{HOUSE RULES}}

Context you can rely on (read these first):
- core/tools/index.ts: TOOLS and runTool(ff, tool, files, options, workDir).
- core/ffmpeg.ts: class FFmpeg(ffmpegPath, gifskiPath, exec); ff.onProgress.
- core/formats.ts: resultFile(source, suffix, ext) names a download; FORMATS, STILLS.
- core/tools/mark.ts and mark-config.ts: the options mark reads and their tables.
- core/errors.ts: InputError = the user's mistake, show its message.
- cli/binaries.ts: install(tool), binaryPath(tool). cli/exec.ts: execBinary and the set
  of running children.
- client/src/pages/Mark/Mark.tsx: what the UI sends (the `submit` function).
- client/src/engine/worker.ts: how the web app runs a tool and names the result. The
  CLI must name results the same way.
- scripts/smoke/index.mjs: a native run of the same thing.

Build cli/index.ts (one file; `#!/usr/bin/env node` first line):

  video-tools mark <file|folder|glob>... --logo <png|svg>
      [--position P] [--size small|medium|large] [--filter plain|glass|blur]
      [--shuffle] [--quality 1-100] [--out <dir>]
  video-tools --help | --version

- Parse with node:util parseArgs (strict). No CLI framework. Unknown flag, missing
  --logo, no inputs or unknown tool: print usage to stderr, exit 2.
- The flags are a public contract and mirror the web UI exactly: no `dev` size, no
  `view`, no `tuning`. Reject a value outside the UI's list using core's own tables
  (MARK_POSITIONS, MARK_FILTERS, MARK_SIZES minus dev): do not copy the lists. Apart from
  that the CLI only converts strings to the types the tool expects (quality -> number);
  the tool does the rest. --quality absent sends 100, as the UI does [QUESTION 6].
- --shuffle sends `route: shuffleRoute(position)`, a new route per file as the UI does
  per export. Move shuffleRoute from client/src/pages/Mark/useMarkPreview.ts into
  core/tools/mark-config.ts (it is pure) and import it from there in the client
  [QUESTION 5].
- Inputs: a folder means its files (not recursive) whose extension mark accepts (derive
  from FORMATS and STILLS; see how client/src/tools.ts builds Mark's accept list). A
  pattern with glob characters is expanded by the CLI itself with node:fs/promises
  `glob` (PowerShell passes *.mp4 through literally); check it under both `node` and
  `bun`. Sorted, de-duplicated. A named file is taken as is: the tool refuses what it
  cannot read.
- --out defaults to the current directory; created if missing [QUESTION 8].
- Per file, one at a time: mkdtemp under os.tmpdir() (prefix "videotools-"), new
  FFmpeg(binaryPath("ffmpeg"), binaryPath("gifski"), execBinary), runTool(ff, "mark",
  [file, logo], options, workDir), copy outputPath to
  <out>/<resultFile(basename, suffix, ext).name>, remove workDir in a finally. If that
  name was already written in this run, fail the file rather than overwrite.
- Before the first file: await install("ffmpeg") and install("gifski").
- Output: the runner logs every command through console.log/console.error; silence
  those as smoke does and write your own lines with process.stdout/stderr: per file
  "[n/total] name" with a percentage from ff.onProgress on a TTY, then the written
  path. An InputError prints its message; any other error prints its message and the
  temp-less detail a user can act on. Go on to the next file. Exit 1 if any failed.
- Ctrl+C (SIGINT; also SIGTERM): kill the running children, remove the current workDir
  synchronously, exit 130. The retired `local` branch leaked videotools-* temp folders
  on abort; this must not.
- --version prints cli/package.json's version (import the JSON).

Unit tests (cli/tests/, vitest "node" project, no ffmpeg, no network): flag -> options
conversion including the rejections, and input expansion (folder, glob, de-dup) against
a temp folder. Shape the code so these are testable without exports that exist only
for tests: if that fails, test less and say so.

README.md: a short CLI section (what it is, the command shape, that binaries download
on first run). Behaviour only, no numbers.

Do not: touch cli/package.json's bin/build (next phase), add --jobs, add other tools,
add a config file.

Verify, and report each result:
- bun run typecheck, lint, test, format:check, build (the client must still build with
  shuffleRoute imported from core).
- Make a folder of 3-4 clips from scripts/smoke/assets/videos plus one .gif and one
  .png, in a temp dir. Run:
    bun cli/index.ts mark <dir> --logo scripts/smoke/assets/vectors/logo1.svg --out <out>
  and the same with `node cli/index.ts` if this Node runs .ts directly (it should).
  Report names and sizes of the outputs.
- Glob: `bun cli/index.ts mark "<dir>/*.mp4" --logo …` from PowerShell.
- Ctrl+C during a long file (send SIGINT/CTRL_C to the process): afterwards no
  videotools-* folder is left in the temp dir and no ffmpeg process survives.
- A bad value (--position nowhere) exits 2 with a clear message; an unsupported input
  file (scripts/smoke/assets/videos/mkv.mkv) is reported, the others still done, exit 1.
```

### Main session checklist
- Diff vs brief: one new source file, one test file; `shuffleRoute` moved, not copied; no value lists duplicated from core.
- typecheck, lint, test, build.
- **Manual check:** `bun cli/index.ts mark <folder> --logo logo.svg --quality 99 --position bottom-right --out marked/` over ~5 clips. Mark the same clips in the web app (`bun run dev`) with the same settings. Names must be identical; sizes close (the wasm encoder picks its thread count from the heap, so bytes need not match exactly). Note any file off by more than a few percent and ask why.
- Run the Ctrl+C check yourself and list the temp dir before and after.
- `--help` text against the interface above.

**Risks:** `fs.glob` behaving differently in Node and Bun; SIGINT on Windows not reaching the handler before children die (check both orders leave no folder). **Rollback:** delete `cli/index.ts` and `cli/tests/`, restore `shuffleRoute`.

## Phase 5: package and release (agent B, follow-up)

Assumes questions 1, 9, 10.

### Message B2 (SendMessage to B)

```
Phases 3 and 4 are committed: cli/index.ts is the CLI entry (read it). Now make it a
publishable package. Do not publish anything.

1. Bundle: cli/package.json gets "build": bun build index.ts --target node into one
   file under cli/dist/, "bin": { "video-tools": <that file> }, "files", "engines"
   (the lowest Node whose node:util parseArgs and node:fs/promises glob the CLI needs:
   check, do not guess), description, license and repository fields matching the repo.
   @videotools/core stays a devDependency and is bundled in. cli/dist is git-ignored
   (check .gitignore's "dist/" already covers it) and skipped by oxlint/oxfmt.
2. resvg [QUESTION 1]: the bundle cannot find index_bg.wasm through core/svg.ts's
   relative URL. Make @resvg/resvg-wasm a dependency of video-tools (same pin as
   core's), external in the bundle, and let the host hand core the wasm: the client
   passes Vite's asset URL, cli/ reads the file it resolves from the package. Keep
   core browser-safe and keep the change to core/svg.ts and its callers minimal;
   report the exact shape you chose before polishing if it needs more than svg.ts,
   mark.ts, worker.ts and cli/.
3. Ship cli/gifski/LICENSE and README.md in "files".
4. .github/workflows/cli.yml: on push of tags "cli-v*": checkout, Bun, Node with an npm
   new enough for trusted publishing, bun install --frozen-lockfile, typecheck, test,
   build, fail if the tag is not "cli-v" + cli/package.json's version, then npm publish
   from cli/ with OIDC (permissions: id-token: write, contents: read). No NPM_TOKEN, no
   Changesets. Read npm's current trusted-publishing docs for the exact requirements
   and report the one-time manual steps the owner must do on npmjs.com (including
   whether the package must exist first); do not write those into the repo.
5. README.md: how a release is cut (bump version, tag), in two or three lines.

Verify, and report each result:
- bun run typecheck, lint, test, format:check, build.
- In cli/: bun run build, then `npm pack --dry-run` lists only the bundle, the gifski
  notices and package.json/README; no workspace: string in the packed package.json's
  dependencies.
- `npm pack`, then from an empty temp folder outside the repo:
    npx <path to tarball> mark <clips dir> --logo <svg> --out out
    bunx <path to tarball> mark <clips dir> --logo <png> --out out2
  (or install the tarball there and run its bin, if npx/bunx refuse a tarball path).
  Both must work with an SVG logo and a PNG logo. Delete the tarball afterwards.
- `git status` shows no build output.
```

### Main session checklist
- `npm pack --dry-run` contents and the packed `package.json` yourself; run the tarball from a temp folder with an SVG logo.
- `bun run build` (client) and a browser Mark run with an SVG logo: the resvg change must not break the site.
- Workflow file read line by line: trigger, permissions, no secrets, version/tag check. It cannot be run here; say so in the report to the user, with the manual npm steps.
- SVG logos go through the changed `svg.ts`: covered by the tarball run and the browser run above.

**Risks:** resvg handed in by the host touches the site's Mark path; the workflow is untested until the first tag. **Rollback:** revert the phase's commit; phases 3–4 still work from source (`bun cli/index.ts`).

## Later phases (less detail)

**Phase 6: the other tools (agent C, follow-up).** `loop`, `speed`, `convert`, `sequence` as commands in `cli/index.ts`, each flag list read from its page (`client/src/pages/<Tool>/<Tool>.tsx`) the way Mark's was, values checked against core's tables. `sequence` takes all inputs into one job and one output. Brief names the flag tables found in the pages and requires the list in the report for the user to approve before polishing. Checklist as phase 4, one manual web comparison per tool. Must land before the first publish if question 7 says so.

**Phase 7: "Copy as command" in Mark (agent D, new).** A button in `Mark.tsx` that copies the `video-tools mark …` line for the current settings (placeholders for the files, since a browser has no paths). The string builder is one pure function with a unit test in the client; a second test in `cli/tests/` feeds its output through the CLI's flag conversion and expects the options `Mark.tsx` would send, so UI and CLI cannot drift. Files: `client/src/pages/Mark/*` only (plus that one cli test, agreed with C if phase 8 is running). Brief includes the house rules, the flag table from phase 4, the frontend conventions found in `Mark.tsx`, and a browser check.

**Phase 8: concurrent jobs for bulk Mark (agent C, follow-up; may run beside 7).** Measurement first, no flag: time a fixed batch (glass filter, mixed sizes) at 1, 2, 3 and 4 files at once with a throwaway harness outside the repo, on this machine; report wall time, CPU use and peak memory. The main session brings the table to the user; only if they choose, a follow-up adds `--jobs` (default from the measurement) to `cli/index.ts`, with Ctrl+C then cleaning every running job's folder.

## Final check before the user publishes
- `git grep` for leftovers (`@api`, `api/_`, `postinstall`, `binaries.mjs`) excluding `.claude`.
- typecheck, lint, test, client build, tarball run.
- **The one smoke run:** `bun run smoke final` (with the phase 0 preload if the `Running:` lines are wanted). Expected: `mark` and `light` pass, `quality` shows the 4 baseline failures and no others. Compare `.smoke/final/quality/quality.txt` with `.smoke/base1/quality/quality.txt`; report any case whose scores or sizes moved noticeably to the user rather than fixing it.
- README read once, whole, against the tree.
- Optionally R1: a read-only review of `cli/` and the `core` changes, given the code and the house rules but not this plan's conclusions.
