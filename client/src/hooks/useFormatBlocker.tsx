import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  blockerText,
  formatBlock,
  isAnimatedWebp,
  pickedFormats,
  stillFormat,
  type FormatBlock,
  type FormatOptions,
} from "../sourceFormat";
import { useMessage } from "./useMessage";

// Why the picked file can't go through, from before anything is uploaded.
// One call gives both halves, so they can't disagree: both wordings are
// blockerText's. The return is `short`, which blocks the run (it is the
// action button's tooltip; null = the file can go on, or there is none yet),
// and `long` goes up as an error message over the title, where it stays until
// another file is picked or the tab is left. A file the tool can take gets no
// message at all — it comes back in the format it came in, which is the rule
// everywhere and needs no announcing.
//
// A tool that picks many files (sequence) hands them all over; the first one
// that can't go through speaks for the pick, since none of them will run.
// With every file fit to go, the pick as a whole gets its turn (`oneFormat`).
//
// `stills`: the tool takes raster images as well (mark, sequence). A .webp is
// then taken for a still until its first bytes say it is animated, which no
// tool can read: they are in a moment after the pick, long before a run could
// be. `foreign` (sourceFormat.ts): false where the tool is asked for a format
// rather than keeping its source's (convert, sequence). `oneFormat`: the pick
// must not mix formats (sequence).
export const useFormatBlocker = (
  source: File | File[] | null,
  { stills = false, foreign = true, oneFormat = false }: FormatOptions = {},
): string | null => {
  const files = useMemo(
    () => (source === null ? [] : Array.isArray(source) ? source : [source]),
    [source],
  );
  // The files themselves, rather than a flag, so an answer can't outlive the
  // file it was read from.
  const [animated, setAnimated] = useState<readonly File[]>([]);
  useEffect(() => {
    if (!stills) return;
    let cancelled = false;
    for (const file of files) {
      if (stillFormat(file)?.id !== "webp") continue;
      isAnimatedWebp(file).then(
        (is) => {
          if (!is || cancelled) return;
          setAnimated((seen) => (seen.includes(file) ? seen : [...seen, file]));
        },
        // Unreadable here: the server has the last word on it anyway.
        () => {},
      );
    }
    return () => {
      cancelled = true;
    };
  }, [files, stills]);

  const optionsFor = (file: File): FormatOptions => ({
    stills: stills && !animated.includes(file),
    foreign,
  });
  const mixed = (): FormatBlock | null => {
    if (!oneFormat) return null;
    const labels = pickedFormats(files);
    return labels.length > 1 ? { state: "mixed", labels } : null;
  };
  const block =
    files.map((file) => formatBlock(file, optionsFor(file))).find(Boolean) ??
    mixed();

  const text = block && blockerText(block, { stills });
  // Plain text, except a foreign file: its line stops before "converted", and
  // the link to the convert tool is affixed there.
  useMessage(
    text &&
      (block?.state === "foreign" ? (
        <>
          {text.long}{" "}
          <Link to="/$tool" params={{ tool: "convert" }}>
            converted
          </Link>
        </>
      ) : (
        text.long
      )),
    "error",
  );
  return text ? text.short : null;
};
