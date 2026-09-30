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

// Returns the run-blocking tooltip (null = OK) and posts the long wording as
// an error message. A .webp passes as an animation until its header says it
// is a still. nonSquare (from useVideoSource) blocks every tool.
export const useFormatBlocker = (
  source: File | File[] | null,
  { stills = false, foreign = true, oneFormat = false }: FormatOptions = {},
  nonSquare = false,
): string | null => {
  const files = useMemo(
    () => (source === null ? [] : Array.isArray(source) ? source : [source]),
    [source],
  );
  // Files, not a flag, so an answer can't outlive the file it was read from.
  const [stillWebps, setStillWebps] = useState<readonly File[]>([]);
  useEffect(() => {
    if (stills || !foreign) return;
    let cancelled = false;
    for (const file of files) {
      if (stillFormat(file)?.id !== "webp") continue;
      isAnimatedWebp(file).then(
        (is) => {
          if (is || cancelled) return;
          setStillWebps((seen) => (seen.includes(file) ? seen : [...seen, file]));
        },
        // Unreadable here: the server has the last word anyway.
        () => {},
      );
    }
    return () => {
      cancelled = true;
    };
  }, [files, stills, foreign]);

  const mixed = (): FormatBlock | null => {
    if (!oneFormat) return null;
    const labels = pickedFormats(files);
    return labels.length > 1 ? { state: "mixed", labels } : null;
  };
  const block: FormatBlock | null = nonSquare
    ? { state: "nonSquare" }
    : (files
        .map((file) => formatBlock(file, { stills, foreign }, stillWebps.includes(file)))
        .find(Boolean) ?? mixed());

  const text = block && blockerText(block);
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
