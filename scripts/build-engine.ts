// Compiles the engine for every platform into dist/engine/.
//
//   bun run build:engine
//
// Bun sets a Windows executable's description (Task Manager's name for it)
// only when compiling on Windows; elsewhere the .exe shows up as its file name.
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
