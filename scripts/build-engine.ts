// Compiles the engine for every platform into dist/engine/; with VERSION set
// (the release workflow), also writes the Homebrew formula to dist/videotools.rb.
//
//   bun run build:engine
//
// Apple silicon runs nothing unsigned, so the macOS builds get an ad-hoc
// signature, which needs macOS's own codesign.
import { $ } from "bun";

const ENTRY = "api/_lib/serve.ts";
const TARGETS = [
  ["bun-windows-x64", "videotools-engine-win32-x64.exe"],
  ["bun-darwin-arm64", "videotools-engine-darwin-arm64"],
  ["bun-darwin-x64", "videotools-engine-darwin-x64"],
  ["bun-linux-x64", "videotools-engine-linux-x64"],
];

for (const [target, file] of TARGETS) {
  const windows = target.startsWith("bun-windows-") ? ["--windows-hide-console"] : [];
  const args = ["build", ENTRY, "--compile", `--target=${target}`, ...windows];
  const build = Bun.spawnSync(["bun", ...args, `--outfile=dist/engine/${file}`], {
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);
  if (process.platform === "darwin" && target.startsWith("bun-darwin-")) {
    await $`codesign --force --sign - dist/engine/${file}`;
  }
}

const version = process.env.VERSION;
if (version) {
  const asset = async (file: string) => {
    const sha256 = new Bun.CryptoHasher("sha256")
      .update(await Bun.file(`dist/engine/${file}`).arrayBuffer())
      .digest("hex");
    return `url "https://github.com/sebastiangraz/videotools/releases/download/engine-v${version}/${file}"
      sha256 "${sha256}"`;
  };
  await Bun.write(
    "dist/videotools.rb",
    `class Videotools < Formula
  desc "Engine that runs videotools jobs on this machine"
  homepage "https://videotools-client.vercel.app"
  version "${version}"

  on_macos do
    on_arm do
      ${await asset("videotools-engine-darwin-arm64")}
    end
    on_intel do
      ${await asset("videotools-engine-darwin-x64")}
    end
  end
  on_linux do
    on_intel do
      ${await asset("videotools-engine-linux-x64")}
    end
  end

  def install
    libexec.install Dir["videotools-engine-*"].first => "videotools-engine"
    chmod 0755, libexec/"videotools-engine"
  end

  service do
    run opt_libexec/"videotools-engine"
    keep_alive true
    log_path var/"log/videotools.log"
    error_log_path var/"log/videotools.log"
  end
end
`,
  );
}
