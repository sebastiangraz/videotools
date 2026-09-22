import { useEffect, useState } from "react";
import { ToolPanel } from "../../components/ToolPanel/ToolPanel";
import { DropZone } from "../../components/DropZone/DropZone";
import { FramePreview } from "../../components/FramePreview/FramePreview";
import { Slider } from "../../components/Slider/Slider";
import { Spinner } from "../../components/Spinner/Spinner";
import { Switch } from "../../components/Switch/Switch";
import { useFormatBlocker } from "../../hooks/useFormatBlocker";
import { useToolRun } from "../../hooks/useToolRun";
import { useVideoSource } from "../../hooks/useVideoSource";
import { hasFrames, stillFormat } from "../../sourceFormat";
import { toolById } from "../../tools";
import { useMarkPreview } from "./useMarkPreview";
import form from "../form.module.css";
import styles from "./Mark.module.css";
import { Tooltip } from "../../components/Tooltip/Tooltip";

const TOOL = toolById("mark");

// Watermark images: PNG only. SVG in particular is left out: the server's
// ffmpeg has no SVG decoder, so export the logo as PNG first.
const WATERMARK_ACCEPT = "image/png";

export const Mark = () => {
  const run = useToolRun(TOOL.value);
  const source = useVideoSource();
  // The one tool that takes stills as well: a PNG, JPEG or (still) WebP comes
  // back marked as the image it is.
  const formatBlocker = useFormatBlocker(source.file, { stills: true });
  // The logo, and its frosted-glass switch.
  const [watermark, setWatermark] = useState<File | null>(null);
  const [watermarkUrl, setWatermarkUrl] = useState<string>("");
  const [filterMode, setFilterMode] = useState(false);
  const [quality, setQuality] = useState<number>(100);
  const preview = useMarkPreview(source.file, watermark, filterMode);
  const [previewZoomed, setPreviewZoomed] = useState(false);

  // Object URL for the watermark thumbnail. Revoked when replaced or on
  // unmount.
  useEffect(() => {
    if (!watermarkUrl) return;
    return () => URL.revokeObjectURL(watermarkUrl);
  }, [watermarkUrl]);

  const sourceFile = source.file;
  // A PNG is lossless whatever is asked of it, so it isn't asked.
  const lossless = sourceFile !== null && stillFormat(sourceFile)?.id === "png";
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
        <div className={styles.markInputs}>
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
        </div>
      }
      blocker={
        !source.file
          ? "Upload a file"
          : (formatBlocker ?? (!watermark ? "Upload a watermark" : null))
      }
      run={run}
      onSubmit={submit}
    >
      {/* Frames of the clip, watermarked by the server with the real
          graph; moving the pointer across the box scrubs through
          them (a still has the one, itself). The bare first frame shows until the renders land (and
          stays as the fallback if they fail); a format the browser
          can't decode shows the frame's own note instead. While a set
          of renders is on its way (first logo, new logo, glass toggled)
          a spinner is up and the last set stays, so the frames never
          disagree with each other. The aspect box waits for the source's
          metadata. */}
      {sourceFile && hasFrames(sourceFile) && watermarkUrl && (
        <Tooltip
          content={"Toggle zoom"}
          delay={100}
          disabled={previewZoomed}
          render={
            <div
              className={`${styles.markPreviewContainer}${previewZoomed ? ` ${styles.markPreviewZoomed}` : ""}`}
              onClick={() => setPreviewZoomed((zoomed) => !zoomed)}
              style={{ aspectRatio }}
            />
          }
        >
          <figure
            aria-label="watermark preview"
            aria-busy={preview.loading}
            className={styles.markPreview}
            style={{ aspectRatio }}
          >
            {/* Every render of the set is stacked here and only the
              scrubbed one shown, so scrubbing never waits on an image
              decode. The set stays up, unchanged, until the next one
              replaces it. */}
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
            {/* The bare frame is the renders' stand-in: it lies under
              them, so they fade in over it when they land. */}
            <FramePreview
              file={sourceFile}
              second={0}
              label="first frame"
              className={styles.markPreviewFrame}
            />{" "}
            <div
              className={styles.markPreviewLoading}
              hidden={!preview.loading}
            >
              <Spinner />
            </div>
          </figure>
          {/* One invisible strip per grabbed frame, side by side
            across the box: the one under the pointer picks the frame.
            They sit outside the figure too. */}
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
        </Tooltip>
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

      {!lossless && (
        <div className={form.formGroup}>
          <Slider
            label={
              <>
                {quality === 100
                  ? `Lossless ${quality}%`
                  : `Quality ${quality}%`}
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
      )}
    </ToolPanel>
  );
};
