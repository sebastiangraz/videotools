import { useEffect, useState } from "react";
import { ENGINE } from "@api/formats";
import { engineFetch } from "@src/helpers";
import form from "@src/form.module.css";
import styles from "./EngineSetup.module.css";

type State = "checking" | "ready" | "missing" | "outdated";

const RETRY_MS = 2000;

// Safari never lets an https page reach loopback.
const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);

const isWindows = navigator.userAgent.includes("Windows");

// Opened once, the engine installs itself (api/_lib/serve.ts).
const DOWNLOAD =
  "https://github.com/sebastiangraz/videotools/releases/download/engine/videotools-engine-win32-x64.exe";

// From GitHub at the commit this deployment was built from, so the script
// matches the site; a protected preview would answer with its login page.
const INSTALL = `curl -fsSL https://raw.githubusercontent.com/sebastiangraz/videotools/${__GIT_SHA__ || "main"}/scripts/install.sh | sh`;

// Jobs run in the engine on the visitor's machine; until it answers, this
// says how to get it, and keeps asking.
export const EngineSetup = () => {
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const probe = async () => {
      const health = await engineFetch("/health")
        .then((res) => res.json())
        .catch(() => null);
      if (!live) return;
      const next = !health ? "missing" : health.version === ENGINE.version ? "ready" : "outdated";
      setState(next);
      if (next !== "ready") timer = setTimeout(probe, RETRY_MS);
    };
    void probe();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);

  if (state === "checking" || state === "ready") return null;
  return (
    <section className={styles.panel} aria-label="Engine setup">
      {isSafari ? (
        <p>
          Your videos are processed locally. Safari is not supported yet. Use Chrome or Firefox.
        </p>
      ) : isWindows ? (
        <>
          <p>
            {state === "outdated"
              ? "The helper is out of date. Download it again."
              : "Your videos are processed locally. Run the one-time helper to get started."}
          </p>
          <div className={styles.downloadContainer}>
            <a className={styles.download} href={DOWNLOAD}>
              Download
            </a>
            <p className={form.label}>
              May become blocked by Windows, click Run Anyway to proceed.{" "}
              <a href="https://www.howtogeek.com/721722/how-to-run-a-program-on-windows-11-that-has-been-blocked-by-windows-smart-screen/">
                Learn more
              </a>
            </p>
          </div>
        </>
      ) : (
        <>
          <p>
            {state === "outdated"
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
