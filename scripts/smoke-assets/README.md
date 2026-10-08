# Smoke assets

Inputs for `npm run smoke` (`scripts/smoke.mjs`), all six required. They are
committed so every checkout runs on the same footage; `--assets <dir>` points
at another folder that has them all. Runs record each asset's name and size,
so a diff across different inputs says so.

| File            | Role                                            |
| --------------- | ----------------------------------------------- |
| `video.<ext>`   | The clip every video tool works on              |
| `animation.gif` | GIF source                                      |
| `logo.png`      | Mark watermark (PNG with alpha)                 |
| `logo.svg`      | Mark watermark as SVG                           |
| `images/*`      | Sequence stills, natural filename order (1–100) |
| `logos/*`       | Other-shaped watermarks (PNG/SVG), same order   |
| `light/*`       | Light tracker clips (not used by the cases yet) |

Always derived from `video` at runtime: the preview frame; one equal part per
logo, which the `mark-various-*` cases mark each with its logo and join back
up; `source.mov` and `source.webm`; `source.avif` and a 3-frame `slides.avif`; lossy and lossless
animated WebPs; `reject.mkv` and `reject-anamorphic.mp4` (a container and
non-square pixels the tools must refuse); and Mark's stills `still.png`,
`still.jpg`, `still.webp` and `turned.jpg` (the JPEG with an EXIF rotation).

Keep clips short (about 4–10 s; the loop cases need at least ~4 s): the slow
encoders run on them too, GIF stops at 1500 frames and AVIF at 60 s.

`light/` is written by `bun scripts/light-assets.mjs`: `sweep.mp4`, one radial
gradient crossing left to right; `pair.mp4`, two equally bright ones
wandering and meeting, which a tracker must not flip between; `accel.mp4`,
one swinging ever faster and then resting mid-frame (smoothing lag and
settling); and `pulse.mp4` (53 s), two still ones, left and right, pulsing
round by round to probe switchMargin and holdSeconds: the script prints each
round's start time and what the tracker should do.
`bun scripts/light-track.mjs <clip> --out <mp4>` shows where Mark's light
tracker (api/_lib/light-track.ts) puts the light on any clip.
