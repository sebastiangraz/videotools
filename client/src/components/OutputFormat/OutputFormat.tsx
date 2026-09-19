import { Link } from "@tanstack/react-router";
import { keptFormat } from "../../sourceFormat";
import form from "../../pages/form.module.css";
import styles from "./OutputFormat.module.css";

// Says what a picked file will come back as, before anything is uploaded:
// the same format it came in, on every tool that shows this. A file with no
// format to hand back is told where to go instead; the page blocks the run
// with keptFormatBlocker.
export const OutputFormat = ({ file }: { file: File }) => {
  const kept = keptFormat(file);
  return (
    <div className={form.formGroup}>
      <span className={form.label}>Output</span>
      {kept.state === "kept" && (
        <p className={styles.text}>{kept.format.label}, same as the source</p>
      )}
      {kept.state === "foreign" && (
        <p role="status" className={`${styles.text} ${styles.blocked}`}>
          {kept.name} files can be read but not written, and this tool gives
          back the format it gets.{" "}
          <Link to="/$tool" params={{ tool: "convert" }}>
            Convert it first
          </Link>
          .
        </p>
      )}
      {kept.state === "unreadable" && (
        <p role="status" className={`${styles.text} ${styles.blocked}`}>
          Animated {kept.format.label} can&rsquo;t be read. Use the file it was
          made from.
        </p>
      )}
    </div>
  );
};
