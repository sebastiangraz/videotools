# gifski

`gifski.json` pins the gifski CLI (currently **1.34.0**, from
https://github.com/ImageOptim/gifski/releases/tag/1.34.0). Its binaries are
mirrored, unmodified, to this repo's `gifski-<version>` release, and `npm
install`'s postinstall (`scripts/binaries-install.mjs`) fetches the host's into
`api/_bin/gifski/<platform>/` (gitignored), as it does for ffmpeg:

- `linux-x64` — static-pie linked (no glibc dependency), runs on the Vercel
  function runtime; `vercel.json` bundles it with the functions.
- `win32-x64` — `vercel dev` on Windows.
- `darwin-arm64`, `darwin-x64` — `vercel dev` on macOS; one universal binary.

gifski is AGPL-3.0 (see LICENSE). It runs as an unmodified, separate
subprocess, which is aggregation — it does not affect this repo's licensing.

To update: `npm run gifski:mirror -- <version>` (publishes the release and
rewrites `gifski.json`; needs gh), then `npm install` and
`npm run smoke -- <label> --only gif`.
