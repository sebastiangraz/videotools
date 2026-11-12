# gifski

`BINARIES` in `cli/binaries.ts` pins the gifski CLI, from
https://github.com/ImageOptim/gifski/releases. Its binaries are mirrored,
gzipped, to this repo's `gifski-<version>` release, and the first native run
downloads the host's into the user's cache (`~/.videotools/gifski-<version>/`),
as it does for ffmpeg (the app runs the WebAssembly build from `wasm/Dockerfile`):

- `linux-x64` — static-pie linked (no glibc dependency).
- `win32-x64` — built from the release's tag with the VC++ runtime linked in,
  so it runs on a Windows without it (`cli/binaries.ts` has the build command).
- `darwin-arm64`, `darwin-x64` — one universal binary.

gifski is AGPL-3.0 (see LICENSE). It runs as an unmodified, separate
subprocess, which is aggregation — it does not affect this repo's licensing.

To update: split a new release tarball into gzipped per-platform binaries,
build the Windows one, attach them (and LICENSE) to a new `gifski-<version>`
release here, and update `BINARIES`; the next native run downloads it.
