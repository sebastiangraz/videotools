import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  formatBlock,
  formatBlocker,
  isAnimatedWebp,
  stillFormat,
} from "../sourceFormat";
import { useMessage } from "./useMessage";

// For the tools that hand their source's format back: why the picked file
// can't go through, from before anything is uploaded. One call gives both
// halves, so they can't disagree: the return value blocks the run (it is the
// action button's tooltip; null = the file can go on, or there is none yet),
// and the reason goes up as an error message over the title, where it stays
// until another file is picked or the tab is left. A file the tool can take
// gets no message at all — it comes back in the format it came in, which is
// the rule everywhere and needs no announcing.
//
// `stills`: the tool takes raster images as well (mark). A .webp is then
// taken for a still until its first bytes say it is animated, which no tool
// can read: they are in a moment after the pick, long before a run could be.
export const useFormatBlocker = (
  file: File | null,
  { stills = false }: { stills?: boolean } = {},
): string | null => {
  // The file, rather than a flag, so the answer can't outlive its file.
  const [animated, setAnimated] = useState<File | null>(null);
  useEffect(() => {
    if (!stills || !file || stillFormat(file)?.id !== "webp") return;
    let cancelled = false;
    isAnimatedWebp(file).then(
      (is) => {
        if (is && !cancelled) setAnimated(file);
      },
      // Unreadable here: the server has the last word on it anyway.
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [file, stills]);

  const asStill = stills && animated !== file;
  const block = file && formatBlock(file, asStill);
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
  return file && formatBlocker(file, asStill);
};
