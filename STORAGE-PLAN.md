# Vercel storage reduction plan

Written 2026-09-16 against branch `eslint` (ESM/TypeScript refactor of `api/` is the baseline; nothing here undoes it).
Nothing in this document has been implemented. Steps marked **ASK** delete deployments or blobs and need an explicit go-ahead.

Dashboard reading (Hobby, last 30 days): Functions Storage 7.71 GB / 10 GB, Blob Data Storage 481.9 MB / 1 GB.

---

## Part 1 — Facts

### 1.1 What "Functions Storage" is

Source: https://vercel.com/docs/deployment-storage and https://vercel.com/docs/deployment-retention

- "Functions Storage: Vercel Function bundles stored in each region where Vercel deploys them." It is the sum over **every retained deployment**, not just production ("Each retained deployment can add stored assets and Function bundles"). One region here (`iad1`), so no multiplier.
- Measured as the maximum stored amount per billing day, added across the billing period (GB-months).
- Retention: "Retained deployment output contributes to Deployment Storage while Vercel stores it." Hobby default is 30 days for Canceled / Errored / Preview / Production, and since 2026-04-29 Hobby is **capped at 30 days** (shorter is allowed). Set under Project Settings > Security > Deployment Retention Policy; not settable via CLI (only viewable with `vercel list --policy`). The REST API returns a `deploymentExpiration` object on the project and plausibly accepts it on PATCH, but the docs do not show that verbatim.
- Deleted deployments (manual or expired) enter a **30-day recovery period** before resources are "permanently removed". The docs do not say whether a soft-deleted deployment still counts toward storage during that window. A changelog dated today (https://vercel.com/changelog/hobby-projects-now-retain-fewer-deployments-to-free-up-storage) says Hobby gets 10 GB of Deployment Storage, over-limit teams "can be blocked from deploying", and when over the limit "deployments outside those exceptions are now deleted immediately instead of after 30 days". Treat "storage drops on delete" as **unverified**; the verification step below covers it.
- Never-deleted exceptions on Hobby: last 3 deployments of any type, last 3 Ready production deployments, anything with the production alias, and the latest preview of an active Git branch.
- Hobby limits that matter here: bundle 250 MB uncompressed (5 GB with Large Functions beta), `/tmp` 500 MB, 2 GB memory, 300 s max duration, cron once per day, 12 functions per deployment.

### 1.2 Deployments (measured with `vercel ls`, 2026-09-16)

| Metric | Value |
| --- | --- |
| Retained deployments | 116 (28 Production, 81 Preview, 7 Error, 0 Canceled) |
| Age spread | 43 created in the last 24 h, 11 one day old, 66 aged 26–30 days |
| Current retention policy (`vercel api /v9/projects/...`) | 30 / 30 / 30 / 30 days, `deploymentsToKeep: 10` |
| `api/process` bundle (`vercel inspect`) | 60.67 MB (latest), 57.14 MB (28 days ago) |
| `api/upload` bundle | 0.28 MB |
| Region / compute | `iad1`, Fluid Compute on |

116 × ~60 MB ≈ 7.0 GB, which matches the 7.71 GB reading within the noise of already-expired-but-recoverable deployments. So the number is the compressed bundle as `vercel inspect` reports it (uncompressed would be ~18 GB), multiplied by retained deployment count. Deployment count is the lever, bundle size is the multiplier.

### 1.3 What is in the `api/process` bundle

`includeFiles` = `{node_modules/{ffmpeg-static,@ffprobe-installer}/**,api/_bin/**}`. On the Linux build machine npm only installs the platform's optional packages, so the bundle contains:

| Item | Uncompressed | Compressed (approx.) | Notes |
| --- | --- | --- | --- |
| `ffmpeg-static` ffmpeg linux-x64 (release b6.1.1) | 79.8 MB | 29.4 MB (`.gz` on the GitHub release) | Full GPL build, every codec |
| `@ffprobe-installer/linux-x64` 5.2.0 | 78.9 MB | ~29 MB | Used for 3 probes only (see below) |
| `api/_bin/gifski/linux/gifski` | 1.14 MB | ~0.5 MB | Needed |
| `api/_bin/gifski/win/gifski.exe` | 1.36 MB | ~0.6 MB | **Ships but is never used on Vercel** |
| Handler code, `@vercel/blob`, `nanoid`, ffmpeg-static's nested `agent-base`/`https-proxy-agent` | ~1.5 MB | ~0.5 MB | Traced automatically |
| **Total** | **~163 MB** | **~60.7 MB** | Matches `vercel inspect` |

No other `@ffprobe-installer/*` platform package is installed on Linux (locally on Windows only `win32-x64` exists), so "narrow includeFiles to linux" only saves the gifski exe.

ffprobe is called in exactly three places in `api/_lib/video-processor.ts`: first-image width/height for the sequence tool (line ~387), `getVideoDuration` (format=duration, line ~946) and `getVideoFPS` (r_frame_rate, line ~959). All three values are printed by `ffmpeg -i <file>` on stderr (`Duration: hh:mm:ss.cc`, `Stream #0:0 ... 1920x1080 ..., 29.97 fps`), so ffprobe is replaceable.

### 1.4 Blob store (SDK `list()` with pagination, 2026-09-16; store `videolooper-blob`, `iad1`)

| Metric | Value |
| --- | --- |
| Blobs | 328, 496.8 MB (store metadata agrees: 328 / 496,846,525 bytes) |
| Uploads (stored at the root, filename + random suffix) | 327 blobs, 483.9 MB — **all orphans** |
| `results/` | 1 blob, 12.9 MB — one undeleted result |
| Age | 85 blobs ≥30 d (34 MB), 232 blobs 7–30 d (366 MB), 8 blobs <7 d (65 MB), 2 blobs <1 d (19 MB) |
| By type | avi 175 MB (14 files, the same 19 MB test clip 14 times), png 114 MB (240 files, sequence images), mp4 97 MB, webp 87 MB, gif 19 MB |
| Created per day | Aug 17: 95, Aug 18: 159, Aug 19: 7, Aug 21: 57, Sep 15: 8, Sep 16: 2 |

The dashboard's 481.9 MB is the GB-month **average** of the store size ("Monthly average of your blob store size"), which is why it sits just under the current 497 MB. Deleting the orphans drops the live size to ~0 immediately, but the dashboard figure decays over the following 30 days.

`vercel blob list --limit 1000` printed only 3 rows in one run and all rows in another (`--mode folded`); use the SDK `list()` with cursor pagination (the throwaway audit script in the session scratchpad; full listing saved as `blobs.json`) for anything that must be complete. Any script that ends up in the repo is plain `.ts` run directly by Node, no `.mjs` and no CommonJS.

### 1.5 Code paths that leave orphans

Server (`api/process.ts`): inputs are deleted in `finally`, results are never deleted server-side.

1. **Validation failures return before the `try`** (unknown tool, bad blob URL, too many images at lines ~110–135). The uploads survive.
2. **Hard kills skip `finally`**: 300 s `maxDuration` timeouts and out-of-memory on large converts (2 GB Hobby memory). The 14 copies of the same 19 MB `.avi` and the 40 MB `.webp` fit this pattern.
3. **Results depend on the client**: `results/` blobs are deleted only when the browser finishes the download and fires the fire-and-forget `deleteBlob` (`client/src/VideoToolUploader.tsx` ~line 97 and ~line 398). A closed tab during processing, a failed result download (the non-abort `catch` does not sweep), or a blocked `fetch` leaves the result forever. Only one such orphan exists today, so this path leaks rarely but never self-heals.
4. **Client non-abort errors do not sweep uploads**: in `submit`, only the `signal.aborted` branch deletes `blobUrls`. If upload 3 of 5 throws, or `/api/process` returns a non-2xx before its `try` (case 1) or is unreachable, uploads 1–2 stay. The 240 orphaned PNGs (sequence tool) are consistent with this.
5. **Local `vercel dev` runs** use the same production token (`vercel env pull` exposes it), so any local test that crashes mid-way orphans blobs in the production store.

The Stop button sweep committed today (`c74ece7d`) covers the abort path only; the two orphans created today post-date the migration code and show the leak is still live.

---

## Part 2 — Options, ranked by impact

Effort scale: trivial (< 15 min), low (< 1 h), medium (half a day), high (multi-day).

### A. Deployment retention and pruning — Functions Storage

| # | Option | Est. saving | Effort | Tradeoff |
| --- | --- | --- | --- | --- |
| A1 | Set retention to the minimum for **Preview, Errored, Canceled** (dashboard; "1 day" if offered, else the smallest choice) | ~4.9 GB now (81 preview + 7 error × ~60 MB); steady state = previews created per day × 61 MB, e.g. 29 previews yesterday ≈ 1.8 GB peak, typical day < 0.5 GB | trivial | Preview URLs older than the window return 410. Branch aliases (`videotools-git-<branch>`) keep pointing at the newest preview, so PR links keep working. |
| A2 | Set retention to the minimum for **Production** too | ~1.5 GB (28 − 3 exempt ≈ 25 × 60 MB) | trivial | Instant rollback only reaches production deployments inside the window plus the 3 exempt ones. Acceptable for a hobby project that deploys many times a day. |
| A3 | **ASK** One-off prune of what the policy will not reach fast enough: `vercel remove videotools --safe --yes` (removes every deployment without an alias: keeps production, `git-main`, `git-eslint`) or a targeted REST `DELETE /v13/deployments/{id}` loop from `vercel ls` output | up to ~6.8 GB immediately, **if** soft-deleted deployments stop counting | trivial | Deleted deployments are recoverable for 30 days but can no longer be rolled back to. `vercel remove <project>` **without** `--safe` deletes the entire project. Whether storage drops at deletion or at permanent removal is unverified; Vercel's own note that over-limit Hobby teams get immediate deletion suggests the soft window is normally what holds storage. |
| A4 | Reduce deploy churn (e.g. `ignoreCommand` in `vercel.json` to skip preview builds when only `client/` docs or lint config change, or push less often to the linked branch) | second order: each avoided preview is −61 MB for the retention window | low | Fewer preview URLs to test on. Not worth it once A1 is in place. |

**Keeping milestones for documentation.** Pruning and short retention do not affect git history; any commit can be rebuilt later. To keep a specific point reachable, push a branch at that commit (`git branch milestone/<name> <sha> && git push origin milestone/<name>`): the Git integration builds it with commit metadata, the branch alias `videotools-git-milestone-<name>-grazs-projects.vercel.app` stays stable, and the latest preview of an active branch is exempt from retention deletion. Tags do not trigger builds. The random per-deployment URLs do not survive deletion, so never reference those. Rebuilds are not byte-identical (ffmpeg-static fetches its binary at install time, env vars are read at build time). Each kept milestone holds one bundle of Functions Storage (~60 MB today, ~30 MB after B1) for as long as the branch exists. Deleted deployments can also be restored, original URL included, from Settings > Security > Recently Deleted within 30 days.

### B. Shrinking the `api/process` bundle — multiplier on every retained deployment

| # | Option | Est. saving per deployment | Effort | Tradeoff |
| --- | --- | --- | --- | --- |
| B1 | Drop `@ffprobe-installer/ffprobe`; parse `ffmpeg -i` stderr for dimensions, duration and fps (three call sites) | −29 MB compressed (61 → ~32 MB, −47%); at 116 retained deployments that is −3.4 GB, at 1-day retention ≈ −0.3 to −0.9 GB | low–medium | Parsing stderr is less exact than `r_frame_rate` (ffmpeg prints rounded `fps`/`tbr`; parse `tbr` fallback). Needs the local smoke test (memory notes) and one preview run per tool. |
| B2 | Stop shipping `api/_bin/gifski/win/gifski.exe`: change `includeFiles` to `{node_modules/{ffmpeg-static,@ffprobe-installer}/**,api/_bin/gifski/linux/**}` | −0.6 MB compressed (~1%) | trivial | None on Vercel; local Windows runs still find the exe via `process.cwd()`. |
| B3 | Fetch ffmpeg (and ffprobe if kept) at cold start into `/tmp` from the pinned GitHub release asset (`.../download/b6.1.1/ffmpeg-linux-x64.gz`, 29.4 MB) or from a Blob you upload once | −58 MB compressed (61 → ~2 MB, −96%); makes deployment count almost irrelevant for Functions Storage | medium | Cold start pays a ~29 MB download + gunzip to `/tmp` (~80 MB written; 500 MB limit fine), realistically 1–3 s, and Fluid Compute reuses warm instances so it is paid rarely. Adds a runtime dependency on GitHub (or on Blob: 29 MB per cold start against the 10 GB/month Hobby Blob data transfer ≈ 340 cold starts/month, plus list/put ops). Must pin the tag and verify a sha256; must keep working when `/tmp` already has the file (check before download; serialize concurrent cold starts with a lock file). `ffmpeg-static` still downloads the binary at install time on the build machine (harmless, ~80 MB of build time) unless it is moved to devDependencies and the Windows path switched to an env var for local runs. |
| B4 | Smaller ffmpeg build (custom static build with only h264/vp9/av1/gif/webp/png/jpeg + scale/fade filters) | −10 to −20 MB compressed (full build ~29 MB → a minimal one is typically 8–18 MB gz) | high | Build pipeline to maintain, codec coverage risk for user uploads (the accept list is "video/*, image/*"). Not recommended while B1 and B3 are available. |
| B5 | Large Functions / 5 GB opt-in | 0 | — | Irrelevant: the bundle is 163 MB uncompressed, under the 250 MB rule, and the limit is not the problem. |

### C. Blob lifecycle — Blob Data Storage

| # | Option | Est. saving | Effort | Tradeoff |
| --- | --- | --- | --- | --- |
| C1 | **ASK** One-off cleanup: delete the 327 orphaned uploads and the 1 stale result (everything older than, say, 1 hour) with `del()` in batches from the saved `blobs.json` | −497 MB live now; dashboard average falls to ~0 over 30 days | trivial | Irreversible. The two blobs from today are also orphans (no job is in flight), but a 1-hour age guard keeps the script safe to re-run. `del()` is free (no operation cost). |
| C2a | **Recommended.** In-request sweep: at the start of each job in `api/process.ts`, `list()` uploads and `del()` any older than 1 h (and, until C5 lands, `results/` older than 24 h) | bounds leakage to whatever the hard-kill paths produce between two real jobs; nothing accrues while the app is idle | low | Stale blobs wait for the next job instead of a clock. One `list` advanced op per job (Hobby: 2,000/month free), deletes are free. No new function, secret or schedule; exercised and verified by the normal smoke test. |
| C2b | Daily cron sweeper: `api/cleanup.ts` plus a `crons` entry in `vercel.json` guarded by `CRON_SECRET` | same bound on a fixed ~24 h clock | low | Not recommended: a third function, a secret and a schedule to keep alive, Hobby jitter of ±59 min, and a silent-stop failure mode you only notice on the usage page. C2a covers the same leaks with no new moving parts. |
| C3 | Server: delete inputs on **every** exit, including the early-return validation paths (compute `inputBlobUrls` candidates first, wrap validation in the same `try`/`finally`, or delete in the 400 branches) | small in bytes, removes leak path 1 | trivial | None. |
| C4 | Client: sweep `blobUrls` in the non-abort `catch` as well (currently only on abort) | removes leak path 4 (the biggest historical source: 240 PNGs) | trivial | None; deletes are fire-and-forget already. |
| C5 | **Recommended.** Stream the result in the HTTP response instead of `put` to `results/` (set `Content-Type` and `Content-Disposition`, pipe the output file to `res`, drop the `results/` upload and the client's Blob download + DELETE) | removes the `results/` class of orphans entirely and saves one advanced op + one Blob download per job (Blob data transfer is 10 GB/month on Hobby, function egress is 100 GB) | medium | Streamed responses have no documented byte limit (the 4.5 MB rule is for buffered bodies), but the whole transfer must finish inside the 300 s duration together with processing; verify on a preview with a > 4.5 MB result that no `FUNCTION_RESPONSE_PAYLOAD_TOO_LARGE` appears. No resumable download, and the client must handle a binary response. Cancelling mid-download already aborts processing (`res.on("close")`). |
| C6 | Upload inputs straight to the function instead of Blob | not viable | — | Documented request body limit is 4.5 MB (https://vercel.com/docs/functions/limitations, updated 2026-08-24); a 100 MB body changelog could not be found. Keep client uploads to Blob. |
| C7 | Do not run local `vercel dev` against the production token; create a second Blob store (Hobby allows 100) for `development` or gate deletion sweeps on `VERCEL_ENV` | prevents leak path 5 | low | One more store to manage; `vercel env pull` then yields the dev token. |

### D. Output size / preset changes

They do **not** matter for storage. Functions Storage is unaffected by anything the function produces. Blob storage is a monthly average, and a result that lives for the seconds between `put` and the client's DELETE contributes effectively zero (20 MB × 1 minute / 30 days ≈ 0.5 KB-month). Output size only matters for Blob data transfer (10 GB/month Hobby) and, if C5 is adopted, function egress. Input size (the 200 MB upload cap in `api/upload.ts`) matters more than output size, and only for how large an orphan can be until C2 sweeps it.

---

## Part 3 — Recommended sequence

Quick wins first; each step lists the files it touches and how to verify. Baseline numbers to capture before starting: usage page (7.71 GB / 481.9 MB), `vercel ls` count (116), `vercel inspect <latest>` (60.67 MB), Blob count/size (328 / 496.8 MB).

1. **Retention policy to the minimum for all four states** (A1 + A2). Dashboard only: Project Settings > Security > Deployment Retention Policy. Touches no files. Verify: `vercel ls --yes` (paginate with `--next`) drops toward the exempt set (≤ 3 prod + 3 latest + branch aliases) within ~48 h; Functions Storage on the usage page falls accordingly. If the usage figure does **not** fall while `vercel ls` does, soft-deleted deployments still count and only the 30-day recovery window will clear them; record that and move on (the policy still stops regrowth).
2. **ASK — one-off Blob cleanup** (C1). A throwaway `.ts` script in the scratchpad reading `blobs.json`, deleting everything with `uploadedAt` older than 1 hour via `del([...])` in batches of 100. Touches no repo files. Verify: re-run the audit script (expect 0–2 blobs), `vercel api /v1/storage/stores/store_fTeaLb7DqhiFqrkM?teamId=...` shows `count` near 0; usage page "Blob Data Storage" decays over the following days.
3. **ASK — prune deployments now** (A3), only if step 1 shows storage dropping on deletion and the number is still uncomfortable after 48 h. Prefer the targeted REST loop over `vercel remove videotools --safe`. Verify: `vercel ls` count and the usage page.
4. **Close the leaks in code** (C3 + C4 + B2 together, one small PR on top of `eslint`):
   - `api/process.ts`: delete inputs on validation early-returns.
   - `client/src/VideoToolUploader.tsx`: sweep `blobUrls` in the non-abort `catch`.
   - `vercel.json`: `includeFiles` narrowed to `api/_bin/gifski/linux/**`.
   Verify: local smoke test from the memory notes; preview deploy; `vercel inspect` shows ~60.0 MB; trigger a validation error and a failed sequence upload, then the audit script shows no new blobs.
5. **In-request sweep** (C2a): a small `sweepStale()` in `api/process.ts` (or `api/_lib/blob-sweep.ts`) called before each job. Verify: leave a blob older than 1 h in the store, run one job on a preview, re-list and confirm it is gone.
6. **Drop ffprobe** (B1): `api/_lib/video-processor.ts` (replace the three `runFFprobe` calls with an `ffmpeg -i` stderr parser), `api/process.ts` (remove the import and `ffprobePath`), `package.json`/lockfile (remove `@ffprobe-installer/ffprobe`), `vercel.json` (`includeFiles` loses `@ffprobe-installer`). Verify: local smoke test across all four tools including an image sequence and a variable-frame-rate clip; `vercel inspect` ≈ 32 MB.
7. **Optional, later — fetch ffmpeg at cold start** (B3): `api/_lib/ffmpeg-bin.ts` (download + gunzip + sha256 + lock to `/tmp`), `api/process.ts` (await it before constructing `VideoProcessor`), `package.json` (move `ffmpeg-static` to devDependencies or keep for local), `vercel.json` (`includeFiles` reduced to gifski only). Verify: `vercel inspect` ≈ 2 MB; cold-start latency from `vercel logs`; one run per tool on a preview. Only worth it if after steps 1–6 the steady-state Functions Storage is still a concern; with 1-day retention and ~30 MB bundles it should sit well under 1 GB.
8. **Stream results instead of Blob** (C5): `api/process.ts` and `client/src/VideoToolUploader.tsx`, remove the DELETE branch and the `results/` `put`. Verify on a preview with a > 4.5 MB output; watch for `FUNCTION_RESPONSE_PAYLOAD_TOO_LARGE` in `vercel logs`. Once this is in, the sweep in step 5 only needs to cover uploads.

Expected end state after steps 1–6: Functions Storage well under 1 GB (a heavy day of 30 previews × 32 MB ≈ 1 GB peak, normally < 0.3 GB) and Blob Data Storage in the low tens of MB, both self-maintaining.

---

## Appendix — commands used for the measurements

```
vercel ls --yes [--next <ts>]                       # 116 deployments across 7 pages
vercel inspect <deployment-url>                     # λ api/process (60.67MB)
vercel api /v9/projects/prj_GGbiGphfopHoz9xn0sJfX298k0Jo   # deploymentExpiration (run from PowerShell; Git Bash rewrites the leading slash)
vercel api "/v1/storage/stores?teamId=team_XphOvFlDnDLGPkiv85U0sZQV"   # store size/count
vercel env pull <scratchpad>/.env.vercel --environment production        # BLOB_READ_WRITE_TOKEN for the SDK script
node <scratchpad audit script> blobs.json                                # full paginated SDK listing
npm view @ffprobe-installer/linux-x64@5.2.0 dist.unpackedSize           # 78,926,822
curl -sIL https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-linux-x64.gz   # 29,354,986
```
