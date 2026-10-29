import { ENGINE } from "@api/formats";
import { repoFile, repoRaw, repoRelease } from "@src/helpers";
import type { Health } from "@src/hooks/useEngine";
import form from "@src/form.module.css";
import styles from "./EngineSetup.module.css";

// Safari never lets an https page reach loopback.
const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);

const isWindows = navigator.userAgent.includes("Windows");
const isMac = navigator.userAgent.includes("Macintosh");

// Opened once, the engine installs itself (api/_lib/serve.ts).
const DOWNLOAD = repoRelease(
  "engine",
  isWindows ? "videotools-engine-win32-x64.exe" : "videotools-engine-darwin.zip",
);

// From GitHub rather than this deployment: a protected preview would answer
// with its login page.
const INSTALL = `curl -fsSL ${repoRaw("scripts/install.sh")} | sh`;

// Jobs run in the engine on the visitor's machine; until it answers, this
// says how to get it.
export const EngineSetup = ({ health }: { health: Health }) => {
  if (health === undefined || health?.version === ENGINE.version) return null;
  const outdated = health !== null;
  return (
    <section className={styles.panel} aria-label="Engine setup">
      {isSafari ? (
        <p>
          Your videos are processed locally. Safari is not supported yet. Use Chrome or Firefox.
        </p>
      ) : isWindows || isMac ? (
        <>
          <p>
            {outdated
              ? "The helper is out of date. Download it again."
              : "Your videos are processed locally. Run the one-time helper to get started."}
          </p>
          <div className={styles.downloadContainer}>
            <a className={styles.download} href={DOWNLOAD}>
              Download
            </a>
            <p className={form.label}>
              {isWindows
                ? "May become blocked by Windows, click Run Anyway to proceed."
                : "May become blocked by macOS, click Open Anyway in Privacy & Security."}{" "}
              <a href={repoFile("README.md#the-engine")} target="_blank" rel="noreferrer">
                Learn more
              </a>
            </p>
          </div>
        </>
      ) : (
        <>
          <p>
            {outdated
              ? "The helper is out of date. Run the install command again:"
              : "Your videos are processed locally. Run the one-time helper to get started."}
          </p>
          <code className={styles.command}>{INSTALL}</code>
          <p className={form.label}>If prompted, allow access to apps on this device.</p>
        </>
      )}
    </section>
  );
};
