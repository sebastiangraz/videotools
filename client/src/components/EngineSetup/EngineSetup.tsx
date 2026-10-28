import { useEffect, useState } from "react";
import { ENGINE } from "@api/formats";
import { engineFetch } from "@src/helpers";
import form from "@src/form.module.css";
import styles from "./EngineSetup.module.css";

type State = "checking" | "ready" | "missing" | "outdated";

const RETRY_MS = 2000;

// Safari never lets an https page reach loopback.
const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);

const installCommand = () =>
  navigator.userAgent.includes("Windows")
    ? `irm ${location.origin}/install.ps1 | iex`
    : `curl -fsSL ${location.origin}/install.sh | sh`;

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
          Videos are processed on your computer by the videotools engine, which Safari can't reach.
          Open this page in Chrome, Edge or Firefox.
        </p>
      ) : (
        <>
          <p>
            {state === "outdated"
              ? "Your videotools engine is out of date. Run the install command again:"
              : "Videos are processed on your computer by the videotools engine. Install it once and keep it running:"}
          </p>
          <code className={styles.command}>{installCommand()}</code>
          <p className={form.label}>If the browser asks to access apps on this device, allow it.</p>
        </>
      )}
    </section>
  );
};
