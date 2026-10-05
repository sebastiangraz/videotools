import { useCallback, useRef, useState, ChangeEvent, DragEvent } from "react";
import type { SourceMeta } from "../../hooks/useVideoSource";
import { FramePreview } from "../FramePreview/FramePreview";
import { hasFrames } from "../../sourceFormat";
import styles from "./Upload.module.css";
import { formatBytes, shortenFilename } from "../../helpers";

// Longest side the thumbnail is drawn at (px): a few times its on-screen size.
const THUMB_SIDE = 128;

// The first picked file, small, next to its name: its first frame wherever the
// browser decodes one (video, animations, stills), else the file itself for
// what <img> shows and ImageDecoder doesn't (an SVG watermark). Nothing where
// neither can (a format only the server reads).
const UploadThumb = ({ file }: { file: File }) => {
  // The object URL lives exactly as long as the element showing it.
  const show = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img) return;
      const url = URL.createObjectURL(file);
      img.src = url;
      return () => URL.revokeObjectURL(url);
    },
    [file],
  );

  if (hasFrames(file)) {
    return (
      <div className={styles.uploadThumbContainer}>
        <FramePreview
          file={file}
          second={0}
          label="thumbnail"
          className={styles.uploadThumb}
          maxSide={THUMB_SIDE}
          fallback={null}
        />
      </div>
    );
  }
  if (file.type.startsWith("image/"))
    return (
      <div className={`${styles.uploadThumbContainer} ${styles.uploadThumbImage}`}>
        <img ref={show} alt="" className={styles.uploadThumb} />
      </div>
    );
  return null;
};

// Dropped files skip the native picker's accept filtering, so mirror it:
// entries are either MIME patterns ("video/*") or bare extensions (".mkv").
function matchesAccept(file: File, accept: string): boolean {
  return accept.split(",").some((entry) => {
    const pattern = entry.trim().toLowerCase();
    if (pattern.startsWith(".")) return file.name.toLowerCase().endsWith(pattern);
    if (pattern.endsWith("/*")) return file.type.startsWith(pattern.slice(0, -1));
    return file.type === pattern;
  });
}

// File picker and drop target in one component.
export const Upload = ({
  accept,
  multiple,
  pickerLabel,
  files,
  onFiles,
  meta,
}: {
  accept: string;
  multiple: boolean;
  pickerLabel: string;
  files: File[];
  onFiles: (files: File[]) => void;
  meta?: SourceMeta | null;
}) => {
  // Drag enter/leave also fire on the upload's children, so a plain
  // boolean would flicker off mid-drag; the depth counter only clears once
  // the drag truly leaves the upload.
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
    const dropped = Array.from(e.dataTransfer.files).filter((f) => matchesAccept(f, accept));
    if (!dropped.length) return;
    onFiles(multiple ? dropped : dropped.slice(0, 1));
  };

  const fileUploaded = files.length > 0;

  return (
    <label
      className={`${styles.upload}${dragging ? ` ${styles.uploadActive}` : ""}`}
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
        className={styles.uploadInput}
      />
      {fileUploaded ? (
        <span className={styles.uploadFile}>
          <UploadThumb file={files[0]} />
          <span>{files.length === 1 ? shortenFilename(files[0]) : `${files.length} files`}</span>
        </span>
      ) : (
        <span className={styles.uploadLabel}>
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 8 8">
            <path
              fill="currentColor"
              d="M4.354 2.356v4.641h-.707v-4.64L1.5 4.502l-.5-.5 3-3 3 3-.5.5z"
            />
          </svg>

          <span>{pickerLabel}</span>
        </span>
      )}
      <span className={styles.uploadMeta}>
        {fileUploaded ? (
          <>
            {formatBytes(files.reduce((sum, f) => sum + f.size, 0))}
            {meta && ` · ${meta.w}×${meta.h}`}
            {meta?.fps && ` · ${Number(meta.fps.toFixed(2))} fps`}
          </>
        ) : (
          "or drop it here"
        )}
      </span>
    </label>
  );
};
