import { useEffect, useState } from "react";
import { ENGINE } from "@api/formats";
import { engineFetch } from "@src/helpers";

// The engine on the visitor's machine, by what /<logic>/health answered:
// `checking` until the first probe is back, `missing` when nothing did,
// `reload` on a 409 (the site deployed again since this page loaded). An
// engine older than the logic paths answers no version.
export type Engine = {
  state: "checking" | "missing" | "outdated" | "reload" | "ready";
  version?: number;
};

// One object, so another miss doesn't re-render.
const MISSING: Engine = { state: "missing" };

// A probe's answer (null = none) as the engine's state.
export const engineFrom = (answer: { version?: number; reload?: boolean } | null): Engine =>
  answer === null
    ? MISSING
    : answer.reload
      ? { state: "reload" }
      : {
          state: (answer.version ?? 0) < ENGINE.version ? "outdated" : "ready",
          version: answer.version,
        };

const RETRY_MS = 2000;

// Asks the engine on the visitor's machine until an up-to-date one answers, or
// until only a reload can help.
export const useEngine = () => {
  const [engine, setEngine] = useState<Engine>({ state: "checking" });

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const probe = async () => {
      const next = engineFrom(
        await engineFetch("/health")
          .then((res) => (res.status === 409 ? { reload: true } : res.json()))
          .catch(() => null),
      );
      if (!live) return;
      setEngine(next);
      if (next.state === "missing" || next.state === "outdated") {
        timer = setTimeout(probe, RETRY_MS);
      }
    };
    void probe();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);
  return engine;
};
