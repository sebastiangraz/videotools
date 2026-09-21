import { Link } from "@tanstack/react-router";
import { formatBlock } from "../../sourceFormat";
import styles from "./FormatNotice.module.css";

// Why a picked file can't go through this tool, said before anything is
// uploaded; the page blocks the run with formatBlocker. A file the tool can
// take gets no notice at all — it comes back in the format it came in, which
// is the rule everywhere and needs no announcing.
export const FormatNotice = ({ file }: { file: File }) => {
  const block = formatBlock(file);
  if (!block) return null;
  return (
    <p role="status" className={styles.text}>
      {block.state === "foreign" ? (
        <>
          {block.name} files can be read but not written, and this tool gives
          back the format it gets.{" "}
          <Link to="/$tool" params={{ tool: "convert" }}>
            Convert it first
          </Link>
          .
        </>
      ) : (
        <>
          Animated {block.format.label} can&rsquo;t be read. Use the file it was
          made from.
        </>
      )}
    </p>
  );
};
