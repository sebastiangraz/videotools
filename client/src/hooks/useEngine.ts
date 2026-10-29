import { useEffect, useState } from "react";
import { ENGINE } from "@api/formats";
import { engineFetch } from "@src/helpers";

// What /health answered: undefined until the first probe is back, null when
// nothing did.
export type Health = { version: number } | null | undefined;

const RETRY_MS = 2000;

// Asks the engine on the visitor's machine until an up-to-date one answers;
// `uninstall` removes it (api/_lib/serve.ts) and starts asking again.
export const useEngine = () => {
  const [health, setHealth] = useState<Health>();
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const probe = async () => {
      const next = await engineFetch("/health")
        .then((res) => res.json())
        .catch(() => null);
      if (!live) return;
      setHealth(next);
      if (next?.version !== ENGINE.version) timer = setTimeout(probe, RETRY_MS);
    };
    void probe();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [round]);

  const uninstall = async () => {
    await engineFetch("/uninstall", { method: "POST" }).catch(() => null);
    setRound(round + 1);
  };
  return { health, uninstall };
};
