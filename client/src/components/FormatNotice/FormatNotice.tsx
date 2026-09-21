import { Link } from "@tanstack/react-router";
import { Message } from "../Message/Message";
import { formatBlock } from "../../sourceFormat";

// Why a picked file can't go through this tool, said before anything is
// uploaded; the page blocks the run with formatBlocker. It goes up as an
// error message over the title (components/Message) rather than in the panel,
// and stays there until another file is picked or the tab is left. A file the
// tool can take gets no notice at all — it comes back in the format it came
// in, which is the rule everywhere and needs no announcing.
export const FormatNotice = ({ file }: { file: File }) => {
  const block = formatBlock(file);
  if (!block) return null;
  return (
    <Message kind="error">
      {block.state === "foreign" ? (
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
      )}
    </Message>
  );
};
