import { ENGINE } from "@api/formats";
import { repoFile } from "@src/helpers";
import type { Health } from "@src/hooks/useEngine";
import form from "@src/form.module.css";
import styles from "./EngineSetup.module.css";

// Safari never lets an https page reach loopback.
const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);

const isWindows = navigator.userAgent.includes("Windows");

// winget on Windows, Homebrew (macOS, Linux) elsewhere.
const INSTALL = isWindows
  ? "winget install videotools"
  : "brew install sebastiangraz/tap/videotools && brew services start videotools";
const UPGRADE = isWindows
  ? "winget upgrade videotools"
  : "brew upgrade videotools && brew services restart videotools";
const UNINSTALL = isWindows
  ? "winget uninstall videotools"
  : "brew services stop videotools && brew uninstall videotools";

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
      ) : (
        <>
          <p>
            {outdated
              ? "The helper is out of date. Update it:"
              : "Your videos are processed locally. Install the helper to get started:"}
          </p>
          <code className={styles.command}>{outdated ? UPGRADE : INSTALL}</code>
          <p className={form.label}>
            If prompted, allow access to apps on this device.{" "}
            <a href={repoFile("README.md#the-engine")} target="_blank" rel="noreferrer">
              Learn more
            </a>
          </p>
        </>
      )}
    </section>
  );
};

// For Settings, next to the running engine's version.
export const Uninstall = () => <code className={styles.uninstall}>{UNINSTALL}</code>;
