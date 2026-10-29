// Compiles the engine for every platform into dist/engine/.
//
//   bun run build:engine
//
// Bun sets a Windows executable's description (Task Manager's name for it)
// only when compiling on Windows; elsewhere the .exe shows up as its file name.
import { $ } from "bun";

const ENTRY = "api/_lib/serve.ts";
const TARGETS = [
  ["bun-windows-x64", "videotools-engine-win32-x64.exe"],
  ["bun-darwin-arm64", "videotools-engine-darwin-arm64"],
  ["bun-darwin-x64", "videotools-engine-darwin-x64"],
  ["bun-linux-x64", "videotools-engine-linux-x64"],
];

for (const [target, file] of TARGETS) {
  const windows = target.startsWith("bun-windows-")
    ? ["--windows-hide-console"].concat(
        process.platform === "win32" ? ["--windows-description=videotools engine"] : [],
      )
    : [];
  const args = ["build", ENTRY, "--compile", `--target=${target}`, ...windows];
  const build = Bun.spawnSync(["bun", ...args, `--outfile=dist/engine/${file}`], {
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);
}

// What macOS visitors download: an app (a downloaded bare binary loses its
// execute bit) for both architectures, ad-hoc signed so Gatekeeper offers
// Open Anyway instead of calling it damaged. Needs macOS's own tools.
if (process.platform === "darwin") {
  const app = "dist/videotools engine.app";
  await $`rm -rf ${app} && mkdir -p ${app}/Contents/MacOS`;
  await $`lipo -create dist/engine/videotools-engine-darwin-arm64 dist/engine/videotools-engine-darwin-x64 -output ${app}/Contents/MacOS/videotools-engine`;
  await Bun.write(
    `${app}/Contents/Info.plist`,
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>videotools-engine</string>
  <key>CFBundleIdentifier</key><string>io.graz.videotools-engine</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
`,
  );
  await $`codesign --force --sign - ${app}`;
  await $`ditto -c -k --keepParent ${app} dist/engine/videotools-engine-darwin.zip`;
}
