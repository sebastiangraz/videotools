# gifski

`scripts/binaries.mjs` pins the gifski CLI (currently **1.34.0**, from
https://github.com/ImageOptim/gifski/releases/tag/1.34.0). Its binaries are
mirrored, unmodified, to this repo's `gifski-<version>` release, and `bun
install`'s postinstall (`scripts/binaries-install.mjs`) fetches the host's into
`api/_bin/gifski/<platform>/` (gitignored), as it does for ffmpeg, for the
smoke suites (the app runs the WebAssembly build from `wasm/Dockerfile`):

- `linux-x64` — static-pie linked (no glibc dependency).
- `win32-x64`.
- `darwin-arm64`, `darwin-x64` — one universal binary.

gifski is AGPL-3.0 (see LICENSE). It runs as an unmodified, separate
subprocess, which is aggregation — it does not affect this repo's licensing.

To update: split a new release tarball into gzipped per-platform binaries,
attach them (and LICENSE) to a new `gifski-<version>` release here, update
`BINARIES` in `scripts/binaries.mjs`, then `bun install`.
