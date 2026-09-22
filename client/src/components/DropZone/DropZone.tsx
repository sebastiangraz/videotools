import { useRef, useState, ChangeEvent, DragEvent } from "react";
import styles from "./DropZone.module.css";

// Dropped files skip the native picker's accept filtering, so mirror it:
// entries are either MIME patterns ("video/*") or bare extensions (".mkv").
function matchesAccept(file: File, accept: string): boolean {
  return accept.split(",").some((entry) => {
    const pattern = entry.trim().toLowerCase();
    if (pattern.startsWith("."))
      return file.name.toLowerCase().endsWith(pattern);
    if (pattern.endsWith("/*"))
      return file.type.startsWith(pattern.slice(0, -1));
    return file.type === pattern;
  });
}

// File picker and drop target in one: as a <label> around the (visually
// hidden) file input a click anywhere on it opens the native picker, and the
// drag handlers make the same surface the drop target. The input keeps the
// aria-label, so the zone is announced — and tested — through it. Dropped
// files skip the native picker's accept filtering, so it is mirrored here,
// and a single-file zone keeps only the first match. `thumbnail` is an image
// URL shown ahead of the picked file's name.
export const DropZone = ({
  accept,
  multiple,
  pickerLabel,
  files,
  onFiles,
  thumbnail,
}: {
  accept: string;
  multiple: boolean;
  pickerLabel: string;
  files: File[];
  onFiles: (files: File[]) => void;
  thumbnail?: string;
}) => {
  // Drag enter/leave also fire on the drop zone's children, so a plain
  // boolean would flicker off mid-drag; the depth counter only clears once
  // the drag truly leaves the zone.
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length) onFiles(picked);
  };

  const dragEnter = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };

  const dragLeave = () => {
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  };

  const drop = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files).filter((f) =>
      matchesAccept(f, accept),
    );
    if (!dropped.length) return;
    onFiles(multiple ? dropped : dropped.slice(0, 1));
  };

  return (
    <label
      className={`${styles.dropZone}${dragging ? ` ${styles.dropZoneActive}` : ""}`}
      onDragEnter={dragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={dragLeave}
      onDrop={drop}
    >
      <input
        aria-label={pickerLabel}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={pick}
        className={styles.dropZoneInput}
      />
      {files.length > 0 ? (
        <span className={styles.dropZoneFile}>
          {thumbnail && (
            <img src={thumbnail} alt="" className={styles.dropZoneThumb} />
          )}
          {files.length === 1 ? files[0].name : `${files.length} files`}
        </span>
      ) : (
        <span className={styles.dropZoneLabel}>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 8 8">
            <path
              fill="currentColor"
              d="M4.354 2.356v4.641h-.707v-4.64L1.5 4.502l-.5-.5 3-3 3 3-.5.5z"
            />
          </svg>

          <span>{pickerLabel}</span>
        </span>
      )}
      <span className={styles.dropZoneHint}>
        {files.length > 0 ? "click/drop to replace" : "or drop it here"}
      </span>
    </label>
  );
};
