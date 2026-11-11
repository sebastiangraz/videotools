import { useEffect, useState } from "react";
import { ENGINE } from "@api/formats";
import { engineFetch } from "@src/helpers";

// What /<logic>/health answered: undefined until the first probe is back, null
// when nothing did. An engine older than the logic paths answers no version;
// `reload` is a 409, the site deployed again since this page loaded.
export type Health = { version?: number; reload?: boolean } | null | undefined;

const RETRY_MS = 2000;

// Asks the engine on the visitor's machine until an up-to-date one answers, or
// until only a reload can help.
export const useEngine = () => {
  const [health, setHealth] = useState<Health>();

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const probe = async () => {
      const next = await engineFetch("/health")
        .then((res) => (res.status === 409 ? { reload: true } : res.json()))
        .catch(() => null);
      if (!live) return;
      setHealth(next);
      if ((next?.version ?? 0) < ENGINE.version && !next?.reload) {
        timer = setTimeout(probe, RETRY_MS);
      }
    };
    void probe();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);
  return health;
};
