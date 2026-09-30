# Smoke assets

Inputs for `npm run smoke` (`scripts/smoke.mjs`). They are committed so every
checkout runs on the same footage; `--assets <dir>` points at another folder.
Runs record each asset's name and size, so a diff across different inputs says so.

| File            | Role                                            | Committed   |
| --------------- | ----------------------------------------------- | ----------- |
| `video.<ext>`   | The clip every video tool works on              | `video.mp4` |
| `animation.gif` | GIF source                                      | yes         |
| `logo.png`      | Mark watermark (PNG with alpha)                 | yes         |
| `logo.svg`      | Mark watermark as SVG                           | no          |
| `images/*`      | Sequence stills, natural filename order (1–100) | 3 PNGs      |

Any of these that is missing is synthesized from ffmpeg test patterns (a GIF
from `video`). That is fine for diffing commands and sizes, not for judging
quality by eye.

Always derived from `video` at runtime: the preview frame; `source.mov` and
`source.webm`; `source.avif` and a 3-frame `slides.avif`; lossy and lossless
animated WebPs; `reject.mkv` and `reject-anamorphic.mp4` (a container and
non-square pixels the tools must refuse); and Mark's stills `still.png`,
`still.jpg`, `still.webp` and `turned.jpg` (the JPEG with an EXIF rotation).

Keep clips short (about 4–10 s; the loop cases need at least ~4 s): the slow
encoders run on them too, GIF stops at 1500 frames and AVIF at 60 s.
