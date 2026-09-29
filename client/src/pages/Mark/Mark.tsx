import { useEffect, useRef, useState } from "react";
import { ToolPanel } from "../../components/ToolPanel/ToolPanel";
import { DropZone } from "../../components/DropZone/DropZone";
import { FramePreview } from "../../components/FramePreview/FramePreview";
import { Slider } from "../../components/Slider/Slider";
import { Spinner } from "../../components/Spinner/Spinner";
import { ToggleGroup } from "../../components/ToggleGroup/ToggleGroup";
import { useFormatBlocker } from "../../hooks/useFormatBlocker";
import { useToolRun } from "../../hooks/useToolRun";
import { useVideoSource } from "../../hooks/useVideoSource";
import { hasFrames, stillFormat } from "../../sourceFormat";
import { toolById } from "../../tools";
import {
  useMarkPreview,
  type MarkFilter,
  type MarkSize,
  type MarkView,
} from "./useMarkPreview";
import form from "../form.module.css";
import styles from "./Mark.module.css";
import { Tooltip } from "../../components/Tooltip/Tooltip";
import { Popover } from "../../components/Popover/Popover";
import { useDebugMode } from "../../hooks/useDebugMode";
import { Switch } from "../../components/Switch/Switch";

const TOOL = toolById("mark");

// Watermark images: PNG or SVG (the server rasterizes an SVG to the size the
// frame needs). ".svg" too, for systems that give an SVG no MIME type.
const WATERMARK_ACCEPT = "image/png,image/svg+xml,.svg";

const SIZE_OPTIONS: { value: MarkSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "large", label: "Large" },
];

const FILTER_OPTIONS: { value: MarkFilter; label: string }[] = [
  { value: "plain", label: "Plain" },
  { value: "glass", label: "Glass" },
  { value: "blur", label: "Blur" },
];

// The debug panel's views of the glass, one switch each; the preview shows
// one at a time, so switching one on switches the others off.
const DEBUG_VIEWS: { value: Exclude<MarkView, "render">; label: string }[] = [
  // The lens's displacement map alone (red x, green y, olive no shift),
  // over the frame painted light gray.
  { value: "displacement", label: "Depth map" },
  // The glass over the frame with only its refraction and rim: no frost,
  // tint, ambient light, shadow or logo (the API's MARK_CLEAR).
  { value: "clear", label: "Pure glass" },
];

export const Mark = () => {
  const run = useToolRun(TOOL.value);
  const source = useVideoSource();
  // The one tool that takes stills as well: a PNG, JPEG or WebP (still or
  // animated) comes back marked as the image it is.
  const formatBlocker = useFormatBlocker(
    source.file,
    { stills: true },
    source.nonSquare,
  );
  // The logo, and the look it is laid on with.
  const [watermark, setWatermark] = useState<File | null>(null);
  const [watermarkUrl, setWatermarkUrl] = useState<string>("");
  const [filterMode, setFilterMode] = useState<MarkFilter>("glass");
  const [pickedSize, setPickedSize] =
    useState<Exclude<MarkSize, "dev">>("large");
  const [quality, setQuality] = useState<number>(100);
  const [previewZoomed, setPreviewZoomed] = useState(false);
  // In debug mode (dev only, Shift+D) a panel hangs off the preview, where
  // the preview can be switched to a debug view of the glass; leaving debug
  // mode goes back to the mark.
  const debug = useDebugMode();
  const [debugView, setDebugView] = useState<MarkView>("render");
  // The dev size stands in for the picked one while its switch is on (and
  // only in debug mode); switching it off goes back to the picked size.
  const [devSize, setDevSize] = useState(false);
  const size: MarkSize = debug && devSize ? "dev" : pickedSize;
  const pickSize = (picked: MarkSize) => {
    if (picked === "dev") return;
    setPickedSize(picked);
    setDevSize(false);
  };
  const preview = useMarkPreview(
    source.file,
    watermark,
    filterMode,
    size,
    debug ? debugView : "render",
  );
  const previewRef = useRef<HTMLDivElement | null>(null);

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
        options: { filter: filterMode, size, quality },
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
          of renders is on its way (first logo, new logo, filter changed)
          a spinner is up and the last set stays, so the frames never
          disagree with each other. The aspect box waits for the source's
          metadata. */}
      {sourceFile && hasFrames(sourceFile) && watermarkUrl && (
        <Tooltip
          content={"Toggle zoom"}
          delay={100}
          align="end"
          disabled={previewZoomed}
          render={
            <div
              ref={previewRef}
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
      {sourceFile && hasFrames(sourceFile) && watermarkUrl && (
        <Popover
          open={debug}
          className={styles.markPreviewDebug}
          anchor={previewRef}
          side="right"
          sideOffset={16}
        >
          <p>debug</p>
          {DEBUG_VIEWS.map(({ value, label }) => (
            <div key={value} className={form.switchRow}>
              <Switch
                id={`markDebug-${value}`}
                checked={debugView === value}
                onCheckedChange={(on) => setDebugView(on ? value : "render")}
                disabled={false}
              />
              <label htmlFor={`markDebug-${value}`} className={form.label}>
                {label}
              </label>
            </div>
          ))}
          <div className={form.switchRow}>
            <Switch
              id="markDebug-devSize"
              checked={devSize}
              onCheckedChange={setDevSize}
              disabled={false}
            />
            <label htmlFor="markDebug-devSize" className={form.label}>
              Dev size
            </label>
          </div>
        </Popover>
      )}
      <div className={form.horizontal}>
        {watermark && (
          <div className={form.formGroup}>
            <span id="markSize" className={form.label}>
              Size
            </span>
            <ToggleGroup
              labelledBy="markSize"
              options={SIZE_OPTIONS}
              value={size}
              onValueChange={pickSize}
              disabled={run.busy}
            />
          </div>
        )}

        {/* Glass and blur take their shape from the logo, so the choice
          waits for one. */}
        {watermark && (
          <div className={form.formGroup}>
            <span id="markFilter" className={form.label}>
              Filter
            </span>
            <ToggleGroup
              labelledBy="markFilter"
              options={FILTER_OPTIONS}
              value={filterMode}
              onValueChange={setFilterMode}
              disabled={run.busy}
            />
          </div>
        )}
      </div>
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
            min={0}
            max={100}
            step={1}
            disabled={run.busy}
          />
        </div>
      )}
    </ToolPanel>
  );
};
