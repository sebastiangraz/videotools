import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  blockerText,
  formatBlock,
  isAnimatedWebp,
  stillFormat,
  type FormatOptions,
} from "../sourceFormat";
import { useMessage } from "./useMessage";

// Why the picked file can't go through, from before anything is uploaded.
// One call gives both halves, so they can't disagree: the return value blocks
// the run (it is the action button's tooltip; null = the file can go on, or
// there is none yet), and the reason goes up as an error message over the
// title, where it stays until another file is picked or the tab is left. A
// file the tool can take gets no message at all — it comes back in the format
// it came in, which is the rule everywhere and needs no announcing.
//
// A tool that picks many files (sequence) hands them all over; the first one
// that can't go through speaks for the pick, since none of them will run.
//
// `stills`: the tool takes raster images as well (mark, sequence). A .webp is
// then taken for a still until its first bytes say it is animated, which no
// tool can read: they are in a moment after the pick, long before a run could
// be. `foreign` (sourceFormat.ts): false where the tool is asked for a format
// rather than keeping its source's (convert, sequence).
export const useFormatBlocker = (
  source: File | File[] | null,
  { stills = false, foreign = true }: FormatOptions = {},
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
  const block =
    files.map((file) => formatBlock(file, optionsFor(file))).find(Boolean) ??
    null;

  useMessage(
    block &&
      (block.state === "foreign" ? (
        <>
          {block.name} files need to be{" "}
          <Link to="/$tool" params={{ tool: "convert" }}>
            converted
          </Link>
        </>
      ) : (
        <>
          {stills ? "Animated " : ""}
          {block.format.label} format not supported.
        </>
      )),
    "error",
  );
  return block && blockerText(block);
};
