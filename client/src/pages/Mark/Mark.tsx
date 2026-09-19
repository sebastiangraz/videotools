import { useEffect, useState } from "react";
import { ToolPanel } from "../../components/ToolPanel/ToolPanel";
import { DropZone } from "../../components/DropZone/DropZone";
import { FramePreview } from "../../components/FramePreview/FramePreview";
import { OutputFormat } from "../../components/OutputFormat/OutputFormat";
import { Slider } from "../../components/Slider/Slider";
import { Switch } from "../../components/Switch/Switch";
import { useToolRun } from "../../hooks/useToolRun";
import { isAnimatedImage, useVideoSource } from "../../hooks/useVideoSource";
import { keptFormatBlocker } from "../../sourceFormat";
import { toolById } from "../../tools";
import { useMarkPreview } from "./useMarkPreview";
import form from "../form.module.css";
import styles from "./Mark.module.css";

const TOOL = toolById("mark");

// Watermark images: PNG only. SVG in particular is left out: the server's
// ffmpeg has no SVG decoder, so export the logo as PNG first.
const WATERMARK_ACCEPT = "image/png";

export const Mark = () => {
  const run = useToolRun(TOOL.value);
  // The source may also be a GIF: previewed through an <img>, since <video>
  // won't decode it.
  const source = useVideoSource({ gif: true });
  // The logo, and its frosted-glass switch.
  const [watermark, setWatermark] = useState<File | null>(null);
  const [watermarkUrl, setWatermarkUrl] = useState<string>("");
  const [filterMode, setFilterMode] = useState(false);
  const [quality, setQuality] = useState<number>(100);
  const preview = useMarkPreview(watermark, filterMode);
  const [previewZoomed, setPreviewZoomed] = useState(false);

  // Object URL for the watermark thumbnail. Revoked when replaced or on
  // unmount.
  useEffect(() => {
    if (!watermarkUrl) return;
    return () => URL.revokeObjectURL(watermarkUrl);
  }, [watermarkUrl]);

  const sourceFile = source.file;
  const gifSource = sourceFile != null && isAnimatedImage(sourceFile);
  const aspectRatio = source.dims
    ? `${source.dims.w} / ${source.dims.h}`
    : "16 / 9";
  const { shownRender } = preview;

  const pick = (picked: File[]) => {
    run.clearError();
    preview.reset();
    source.pick(picked);
  };

  const pickWatermark = ([picked]: File[]) => {
    run.clearError();
    setWatermark(picked);
    setWatermarkUrl(URL.createObjectURL(picked));
  };

  const submit = () => {
    if (!source.file || !watermark) return;
    run.start({
      files: [source.file],
      extras: [{ file: watermark, status: "Uploading watermark" }],
      payload: ({ blobUrls, extraUrls }) => ({
        blobUrl: blobUrls[0],
        watermarkUrl: extraUrls[0],
        options: { filter: filterMode, quality },
      }),
    });
  };

  return (
    <ToolPanel
      tool={TOOL}
      inputs={
        <>
          <DropZone
            {...TOOL.input}
            files={source.file ? [source.file] : []}
            onFiles={pick}
          />
          <DropZone
            accept={WATERMARK_ACCEPT}
            multiple={false}
            pickerLabel="choose watermark"
            files={watermark ? [watermark] : []}
            onFiles={pickWatermark}
            thumbnail={watermarkUrl}
          />
        </>
      }
      blocker={
        !source.file
          ? "Upload a file"
          : (keptFormatBlocker(source.file) ??
            (!watermark ? "Upload a watermark" : null))
      }
      run={run}
      onSubmit={submit}
    >
      {source.file && <OutputFormat file={source.file} />}

      {/* Frames of the clip, watermarked by the server with the real
          graph; moving the pointer across the box scrubs through
          them. The bare first frame shows until a render lands (and
          stays as the fallback if it fails); a format the browser
          can't decode shows the frame's own note instead. The aspect
          box waits for the video's metadata. */}
      {sourceFile && source.url && watermarkUrl && (
        <div
          className={`${styles.markPreviewContainer}${previewZoomed ? ` ${styles.markPreviewZoomed}` : ""}`}
          onClick={() => setPreviewZoomed((zoomed) => !zoomed)}
          style={{ aspectRatio }}
        >
          <figure
            aria-label="watermark preview"
            className={styles.markPreview}
            style={{ aspectRatio }}
          >
            {/* The bare frame is the render's stand-in, so once a
                render is up it is hidden rather than left showing
                through — a GIF would otherwise be seen playing
                underneath. */}
            {gifSource ? (
              <img
                src={source.url}
                alt="first frame"
                className={
                  shownRender >= 0
                    ? `${styles.markPreviewFrame} ${styles.markPreviewFrameHidden}`
                    : styles.markPreviewFrame
                }
                onLoad={(e) => {
                  const img = e.currentTarget;
                  source.setDims({
                    w: img.naturalWidth,
                    h: img.naturalHeight,
                  });
                  preview.grabGifFrames(sourceFile, img);
                }}
              />
            ) : (
              <>
                <FramePreview
                  src={source.url}
                  second={0}
                  label="first frame"
                  className={
                    shownRender >= 0
                      ? `${styles.markPreviewFrame} ${styles.markPreviewFrameHidden}`
                      : styles.markPreviewFrame
                  }
                />
                {/* The frames are grabbed off a second, undisplayed
                    <video>, so its seeking never shows through the bare
                    frame above. */}
                <FramePreview
                  src={source.url}
                  second={0}
                  label="frame grab source"
                  className={styles.markPreviewGrab}
                  onFrame={preview.grabVideoFrames}
                />
              </>
            )}
            {/* Every landed render is stacked here and only the
                scrubbed one shown, so scrubbing never waits on an image
                decode. A slot's last render stays up, unchanged, until
                the next one replaces it. */}
            {preview.previewUrls.map(
              (url, i) =>
                url && (
                  <img
                    key={i}
                    src={url}
                    alt={i === shownRender ? "watermarked frame" : ""}
                    className={
                      i === shownRender
                        ? styles.markPreviewRender
                        : `${styles.markPreviewRender} ${styles.markPreviewFrameHidden}`
                    }
                  />
                ),
            )}
          </figure>
          {/* One invisible strip per grabbed frame, side by side
              across the box: the one under the pointer picks the frame.
              They sit outside the figure so its zoom doesn't stretch
              them. */}
          {preview.frameCount > 1 && (
            <div className={styles.markPreviewScrub} aria-hidden="true">
              {Array.from({ length: preview.frameCount }, (_, i) => (
                <div key={i} onPointerEnter={() => preview.setScrubIndex(i)} />
              ))}
            </div>
          )}
          {preview.previewError && (
            <figcaption className={styles.markPreviewNote}>
              Preview unavailable
            </figcaption>
          )}
        </div>
      )}

      {/* The glass takes its shape from the logo, so the switch waits
          for one. */}
      {watermark && (
        <div className={form.switchRow}>
          <label htmlFor="filterMode" className={form.label}>
            Glass
          </label>
          <Switch
            id="filterMode"
            checked={filterMode}
            onCheckedChange={setFilterMode}
            disabled={run.busy}
          />
        </div>
      )}

      <div className={form.formGroup}>
        <Slider
          label={
            <>
              {quality === 100 ? `Lossless ${quality}%` : `Quality ${quality}%`}
            </>
          }
          value={quality}
          onValueChange={setQuality}
          min={1}
          max={100}
          step={1}
          disabled={run.busy}
        />
      </div>
    </ToolPanel>
  );
};
