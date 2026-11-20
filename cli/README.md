### The CLI for [videotoo.ls](https://videotoo.ls), allows individual & bulk processing of videos and images. The first run downloads ffmpeg and gifski.

```bash
# help start page
npx @videotools/cli --help

# help for a specific tool
npx @videotools/cli MARK --help
```

---

**TOOLS**

```text
LOOP                        Loop each video seamlessly.
SEQUENCE                    Make one video or animation of all the images, in the order given.
SPEED                       Speed each video up or slow it down.
CONVERT                     Convert each video to another format.
MARK                        Watermark each video or image.
```

---

**LOOP**

```bash
npx @videotools/cli LOOP <video.mp4|folder|glob> …
```

```text
--technique <how>           reverse|crossfade (default: crossfade)
--fade <seconds>            from 0 to 10 (default: 0.5; only with --technique crossfade)
--start <seconds>           from 0 up: where the loop starts (default: 0; only with --technique crossfade)
--quality <n>               from 0 to 100 (default: 100)
--out <dir>                 Override the default output directory (default: .)
--verbose-names             Append settings to the file name
```

---

**SEQUENCE**

```bash
npx @videotools/cli SEQUENCE <img.png|folder|glob> …
```

```text
--frame-duration <seconds>  from 0.1 to 10: how long each image shows (default: 1)
--format <format>           mp4|gif|webp|avif (default: mp4)
--quality <n>               from 0 to 100 (default: 100)
--out <dir>                 Override the default output directory (default: .)
--verbose-names             Append settings to the file name
```

---

**SPEED**

```bash
npx @videotools/cli SPEED <video.mp4|folder|glob> …
```

```text
--speed <n>                 from -3 to 3: 1 is twice as fast, -1 half as fast, 3 and -3 four times; a negative as --speed=-1 (default: 0)
--out <dir>                 Override the default output directory (default: .)
--verbose-names             Append settings to the file name
```

---

**CONVERT**

```bash
npx @videotools/cli CONVERT <video.mp4|folder|glob> …
```

```text
--to <format>               mp4|webm|mov|gif|webp|avif: by default mp4, or webm for an mp4
--quality <n>               from 0 to 100 (default: 100)
--fps <n>                   from 1 to 30: by default the source's (only with --to gif)
--width <px>                from 100 to 800 (default: 640; only with --to gif)
--out <dir>                 Override the default output directory (default: .)
--verbose-names             Append settings to the file name
```

---

**MARK**

```bash
npx @videotools/cli MARK <img.png|folder|glob> … --logo logo.svg
```

```text
--logo <png|svg>            the watermark (required)
--position <at>             top-left|top|top-right|left|center|right|bottom-left|bottom|bottom-right (default: bottom-right)
--size <size>               small|medium|large (default: medium)
--filter <filter>           plain|glass|blur (default: glass)
--shuffle                   randomly shuffle the --position value over time
--quality <n>               from 0 to 100 (default: 100)
--out <dir>                 Override the default output directory (default: .)
--verbose-names             Append settings to the file name
```
