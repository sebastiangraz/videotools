# Smoke assets

Inputs for `npm run smoke` (see `scripts/smoke.mjs`). Anything missing here is
synthesized from ffmpeg test patterns, which is fine for comparing commands and
file sizes between runs but useless for judging quality by eye. Drop real
footage here for that:

| File                    | Used as                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| `video.<any extension>` | The clip every video tool works on (Loop, Speed, Convert, Mark)   |
| `animation.gif`         | GIF source for Loop / Speed / Mark. Made from `video` when absent |
| `logo.png`              | The Mark tool's watermark (PNG with alpha)                        |
| `images/*`              | The Sequence tool's stills, in natural filename order (1–100)     |

The preview frame is always taken from `video`, like the browser does. So are
the sources in the other formats the tools have to hand back (`source.mov`,
`source.webm`, a small `source.avif`), `reject.mkv`, a container they have
to refuse, and the Mark tool's still sources: the first frame as `still.png`,
`still.jpg`, `still.webp` and `turned.jpg` (the JPEG again, with an EXIF
orientation that stands it on end).

Keep clips short (about 4–10 s, the loop cases need at least ~4 s): the slow
encoders (AVIF, lossless WebP) run on them too, GIF stops at 1500 frames and
AVIF at 60 s. Another folder can be used with `--assets <dir>`.

The folder's contents are gitignored (footage is large). Runs record each
asset's name and size, so comparing runs made from different inputs says so.
