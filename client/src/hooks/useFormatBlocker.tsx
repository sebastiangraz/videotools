import { Link } from "@tanstack/react-router";
import { formatBlock, formatBlocker } from "../sourceFormat";
import { useMessage } from "./useMessage";

// For the tools that hand their source's format back: why the picked file
// can't go through, from before anything is uploaded. One call gives both
// halves, so they can't disagree: the return value blocks the run (it is the
// action button's tooltip; null = the file can go on, or there is none yet),
// and the reason goes up as an error message over the title, where it stays
// until another file is picked or the tab is left. A file the tool can take
// gets no message at all — it comes back in the format it came in, which is
// the rule everywhere and needs no announcing.
export const useFormatBlocker = (file: File | null): string | null => {
  const block = file && formatBlock(file);
  useMessage(
    block &&
      (block.state === "foreign" ? (
        <>
          {block.name} files can be read but not written.{" "}
          <Link to="/$tool" params={{ tool: "convert" }}>
            Convert it first
          </Link>
        </>
      ) : (
        <>
          Animated {block.format.label} can&rsquo;t be read. Use the file it was
          made from
        </>
      )),
    "error",
  );
  return file && formatBlocker(file);
};
