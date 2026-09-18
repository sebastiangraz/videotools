# Video Tools

A web application with video tools: seamless loops from uploaded videos, image-sequence-to-video assembly, speed changes, format conversion and watermarking. Deployed on Vercel: a static React frontend plus serverless functions that run ffmpeg, with Vercel Blob for file transfer (uploads and results bypass the ~4.5 MB serverless body limit).

## Project Structure

```
videotools/
├─ api/                  # Vercel serverless functions
│  ├─ upload.ts          # Issues Vercel Blob client-upload tokens
│  ├─ process.ts         # Downloads upload(s), runs ffmpeg, stores result (also DELETE cleanup)
│  ├─ preview.ts         # Renders the mark tool's preview frame (inline images, no Blob)
│  ├─ _bin/
│  │  └─ gifski/         # Vendored gifski binaries (video → GIF encoding)
│  └─ _lib/
│     ├─ binaries.ts     # ffmpeg-static / gifski paths shared by the functions
│     └─ video-processor.ts  # ffmpeg/gifski pipeline (loops, sequences, conversion, watermarks)
├─ client/               # React + Vite frontend
│  └─ src/
│     ├─ VideoToolUploader.tsx      # Upload component
│     └─ VideoToolUploader.test.tsx # Component tests
├─ vercel.json           # Function memory/duration config
└─ package.json          # Root package (npm workspaces: client)
```

## How it works

1. The browser uploads the file(s) **directly to Vercel Blob** via `@vercel/blob/client` (token issued by `/api/upload`; capped at 200 MB per file, video/image content types only).
2. The browser POSTs `{ tool, filename, blobUrl | blobUrls, watermarkUrl?, options }` to `/api/process`. The function downloads the blob(s) to `/tmp`, runs ffmpeg (`ffmpeg-static`, a real binary, no bash; `ffmpeg -i` doubles as the probe, so no ffprobe ships), uploads the result to Blob, and returns `{ url, downloadUrl, filename }`. The input blobs are deleted afterwards.
3. The browser downloads the result and fires a best-effort `DELETE /api/process` to remove the result blob.

A **Stop** button fades in next to the action button while a run is in flight. It aborts the whole chain client-side (upload, processing request, result download) via one `AbortController`, then deletes whatever blobs that run created; switching tabs mid-run aborts the same way. Server-side, `api/process.ts` listens for the response's `close` event and, if it fires before the response was written, kills the running ffmpeg/gifski child so the function stops encoding — best effort, since it relies on the platform propagating the client disconnect to the function.

## Tools

Each tool is a tab with its own URL (`/loop`, `/sequence`, `/speed`, `/convert`, `/mark` — TanStack Router; `/` and unknown paths redirect to `/loop`); adding a tool means one entry in `TOOLS` (client) + `VALID_TOOLS` (server) and a conditional options block in the component — routes, tabs and the SPA rewrite need no changes (the rewrite in `vercel.json` is a catch-all that already excludes `api/` and Vite's module URLs).

- **Loop**: seamless video loop. Options: `technique` — `reverse` (plays the video forward then reversed, no further options) or `crossfade` (adds `fadeDuration` in seconds and `startSecond` to choose the first frame, for thumbnails/social media) — and `quality` (1–100 slider, maps to the x264 CRF of the output; intermediate clips are always encoded near-lossless so quality is only spent once). Output is mp4, which is never fully lossless: quality 100 uses CRF 1 (visually lossless) because true lossless x264 forces a profile most players can't decode.
- **Video speed**: speed a clip up or slow it down. Option: `speed` slider from −3 to +3 (0 = unchanged, center). The value is a signed ratio: +1 plays 2× faster (10 s → 5 s), −1 plays 2× slower (10 s → 20 s), ±3 → 4×. Audio is dropped (as in the other tools).
- **Converter**: convert a video to another format. A single "Convert to" dropdown lists the targets (MP4 / WebM / MOV / GIF / WebP / AVIF) minus the uploaded file's own format; any container ffmpeg reads works as input (AVI, MKV, WMV, …). Video targets keep audio (H.264+AAC for MP4/MOV, VP9+Opus for WebM); animated-image targets (GIF/WebP/AVIF) drop it. Animated-image targets (GIF/WebP/AVIF) cap the width at 800 px. **GIF is encoded by [gifski](https://gif.ski)** (vendored binary in `api/_bin/gifski/`, ffmpeg extracts the frames): pngquant palettes + temporal dithering, far better than ffmpeg's own GIF encoder. GIF exposes `fps` (1–30, empty = match the source framerate) and `width` (100–800 px) next to the shared `quality` slider; videos whose `duration × fps` exceeds 600 frames are rejected with a hint to lower the FPS (PNG frames must fit the function's `/tmp` — so 20 s max at 30 fps, 40 s at 15 fps). WebP/AVIF also match the source framerate (capped at 30). Note that GIF and animated WebP are **intra-only** formats — every frame is a standalone image with no motion compensation — so their output is often _larger_ than the source video despite smaller dimensions; they're meant for short clips where compatibility matters more than size. WebP at quality 100 switches to **true lossless** (no VP8 quantization, so no block artifacts on solid colors — expect very large files); below 100 the slider maps to libwebp 65–100, the range where VP8 keeps fine texture instead of flattening it into a visible block grid. AVIF caps at 60 s (libaom is too slow for more within the 300 s limit).
- **Mark**: stamp a watermark onto a video (or an animated GIF — ffmpeg reads it like any video; output is still mp4). Two uploads: the video and a logo image (PNG / JPEG / GIF / WebP; the client sends the logo as `watermarkUrl` next to `blobUrl`). SVG is not accepted — the bundled ffmpeg has no SVG decoder — so export the logo as PNG first. Position and size are fixed: the logo is fitted into a box 16% of the video's width and height in the bottom-right corner (each shape is then drawn at its own scale of that box — `elongatedScale` for logotypes and tall marks, `squarishScale` for square-ish logos within 5:4, which read heavier and so sit at 75%), padded from the edges by its own size — a logotype's height, a tall mark's width, a square-ish one's mean of both × 0.5, capped at `maxPaddingRatio` of the frame's shorter side so an asset with lots of empty canvas around the mark doesn't drift inwards (constants in `MARK` in `video-processor.ts`, all relative to the video so the mark reads the same at every resolution). Animated GIFs loop for the length of the video (`-stream_loop -1` at the demuxer, `shortest=1` in the graph). Options: `filter` (boolean, offered only for formats that can carry transparency — PNG / GIF / WebP) and `quality` (x264 CRF like the other tools). Filter mode is a Liquid-Glass look: the logo's alpha becomes a thick glass lens. Its shape is turned into a heightfield (the alpha blurred at two widths — `bevelRatio` of the logo's shorter drawn side, and a third of that — remapped so it rises from 0 at the edge to full inside, averaged, and clipped to the alpha) whose Sobel gradient drives ffmpeg's `displace`: the video under the bevel is pulled in from just outside the edge (`refractRatio` of the frame's shorter side where the bevel is steepest, easing to nothing inward; displace tops out at 127 map px, 63 px of video, so the default is past that on purpose and much of the bevel bends by the full amount), with red displaced a little less and blue a little more than green (`chroma`) for a hint of dispersion. The refraction runs at 2× (displace moves whole pixels) and is brought back down. The Sobel gain never goes through `convolution`'s `rdiv`: ffmpeg-static ships different ffmpeg versions per platform (6.1.1 on Windows, 7.0.2 on Linux, so on Vercel), 6.1 ignores a given `rdiv` and 7.0 applies it, which once left the deployed glass flat while localhost bent. `rdiv` stays 1 and the gain is split between a 16-bit scale of the heightfield and integer kernel taps, which renders bit-identically on both. The flat interior is frosted (blurred by `blurRatio`, saturated, lightened with white) while the bevel keeps the refracted backdrop nearly sharp — blurred only by the floor `minBlurRatio` (1.6 px at 1080p), so small islands and thin strokes, which are bevel all the way through, don't show hard backdrop edges cutting across them, and big shapes ramp from that floor at the rim to the full frost inside; a thin rim inside the edge (1 px at 720p, scaling up), painted not white but with the refracted backdrop under it — saturated (`rimSaturation`), brightened like a colour dodge (`rimGain`) and mixed a little towards white (`rimWhite`), so it takes a vivid version of the video's hue while staying brighter than it — is lit by the slope facing the light (`lightAngle`, top-left by default) at `rimOpacity`, easing down around the shape to the `glint` level, which the rest of the rim holds all the way round (a glint that ramped up separately on the far edge notched the rim wherever an edge turned side-on to the light); an ambient gradient lies over the fill for depth on flat video (radial, centred one logo radius off the logo on the side opposite `lightAngle` and `ambientReach` radii wide, so across the logo it reads as a gently curved linear ramp: white at `ambient` opacity on that far side (bottom-right by default), fading to black at `ambientShade` of that on the light's own side, masked by the logo's alpha and under the rim); a soft shadow sits behind it; and the logo's own pixels are blended on top at 45% (a white logo brightens the glass, a dark one smokes it, a coloured one tints it). The layers are stacked on a transparent canvas and laid on the frame, so only pixels the glass or its shadow cover change, and the patch's YUV→RGB conversion and the stack's way back both name one matrix (the source's own tag as probed, which makes a JPEG frame grab or an RGB source bt601 at any size; untagged video gets bt709 from 720 lines up, bt601 below): left to auto, the way in follows the source's colour tag and the way back falls to bt601, which on bt709-tagged files (most HD exports) showed the whole patch as a faint hue-shifted box. Following the tag matters on ffmpeg 7, where filter links carry a colour space: a patch tagged differently from the frame makes `overlay` convert the whole frame, which shifted every colour of the HD preview JPEG. Everything is still one ffmpeg pass on just the patch of video under the logo (plus a margin for the blur and shadow), not the full frame; core lavfi filters only (`gblur`, `lut`, `convolution`, `displace`, `blend`, `overlay`, …), no shaders or GPU. `displace` has no sync options but always stops with its source and repeats its maps, so still logos and looped GIFs both work; the other three-way mix is done with `alphamerge` + `overlay` (which take `shortest`) rather than `maskedmerge` (which doesn't). Audio is kept (AAC); output is mp4. Once both files are picked the UI shows an inline preview **rendered by the server with the same ffmpeg graph** (`renderWatermarkFrame` in `video-processor.ts`, served by `/api/preview`): the browser grabs the video's first frame off its `<video>` element (downscaled to 1280 px wide — the geometry is relative, so it previews the same), posts it and the logo inline as data URLs (no Blob round trip; 8 MB cap), and gets one composited JPEG back. Whatever the graph does — blur values, future displacement maps — the preview shows it; toggling filter mode re-renders. A change mid-render aborts the request and starts over. The bare first frame stands in until the first render lands (then it's hidden, so a GIF source isn't seen playing underneath), and stays if it fails ("Preview unavailable"); on later changes the previous render stays up until the next replaces it. A GIF source is previewed through an `<img>` (a `<video>` won't decode it; a canvas draws an animated image's first frame). Other formats the browser can't decode show the frame's own note and get no preview.
- **Image sequence → video**: upload multiple images and assemble them into an animation. Options: `frameDuration` ("time per frame" in seconds, 0.02–10), output `format` (MP4 / GIF / AVIF), and `quality` (1–100 slider; maps to x264/libaom CRF, and for GIF to palette size — ≥80 also switches to per-frame palettes). AVIF at quality 100 is truly lossless (RGB, no chroma subsampling — expect much larger files and slower encodes); AVIF ≥90 keeps full chroma resolution (yuv444p). MP4 caps at CRF 1 (visually lossless) since true lossless x264 isn't playable in browsers; GIF is inherently limited to 256 colors. The UI shows a rough estimated output size. Frame order follows the filenames (natural sort, so `img2` comes before `img10`). Mixed sizes/formats are fine — every image is scaled and padded to the first image's dimensions (capped at 1920 px on the longest side).

## Setup

```bash
npm install
npm i -g vercel          # Vercel CLI
vercel link              # link to your Vercel project
```

Then in the Vercel dashboard, create a **Blob store** and connect it to the project (this auto-injects `BLOB_READ_WRITE_TOKEN` — the only env var needed), and pull it locally:

```bash
vercel env pull .env.local
```

No system ffmpeg is required — binaries install with `npm install` (the right platform is picked automatically, including Windows for local dev).

## Development

```bash
npm run dev   # Serves the Vite client + api/ functions on one origin
```

Note: the `onUploadCompleted` webhook warning on localhost is expected and harmless (Blob can't call back into a local URL).

## Testing

```bash
npm test      # client component tests (vitest)
```

## Deployment

```bash
vercel        # preview deploy
vercel --prod # production
```

`vercel.json` sets `api/process.ts` to `maxDuration: 300` and `memory: 2048` (the Hobby plan maximum; on Pro, raise it — the reverse technique buffers all decoded frames in RAM). `api/preview.ts` gets 60 s and the same `includeFiles` so the ffmpeg binary ships with it.

## Limits

- Uploads capped at 200 MB per file (`api/upload.ts`); very long/high-res videos can still exceed the 300 s function duration or `/tmp` space.
- The **reverse** loop on very high-resolution sources (~4K) exceeds the 2 GB Hobby memory limit and fails; 1080p is verified working. Crossfade works even at 4K. Fixes: upgrade to Pro and raise `memory`, or rework `createReverseLoop` to reverse in segments.
- Any container/image ffmpeg can read is accepted (mp4, mov, avi, webm, mkv, png, jpg, webp, …); loop output is always mp4.
- Image sequences: at most 100 images per run. AVIF encoding (libaom) is slow — long sequences at high resolution can approach the 300 s function limit.
- Processing is synchronous — the browser keeps a single request open while the function works.
