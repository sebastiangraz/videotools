import { useRef, useState, type CSSProperties } from "react";
import { ToolPanel } from "../../components/ToolPanel/ToolPanel";
import { Upload } from "../../components/Upload/Upload";
import { FramePreview } from "../../components/FramePreview/FramePreview";
import { Slider } from "../../components/Slider/Slider";
import { Spinner } from "../../components/Spinner/Spinner";
import { ToggleGroup } from "../../components/ToggleGroup/ToggleGroup";
import { ToggleGrid } from "../../components/ToggleGrid/ToggleGrid";
import { useFormatBlocker } from "../../hooks/useFormatBlocker";
import { useToolRun } from "../../hooks/useToolRun";
import { useVideoSource } from "../../hooks/useVideoSource";
import { hasFrames, isStillImage, stillFormat } from "../../sourceFormat";
import { toolById } from "../../tools";
import {
  MARK_POSITIONS,
  shuffleRoute,
  useMarkPreview,
  type MarkFilter,
  type MarkPosition,
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

// The server rasterizes an SVG at the size the frame needs; ".svg" is for
// systems that give an SVG no MIME type.
const WATERMARK_ACCEPT = "image/png,image/svg+xml,.svg";

const SIZE_OPTIONS: { value: MarkSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

const FILTER_OPTIONS: { value: MarkFilter; label: string }[] = [
  { value: "plain", label: "Plain" },
  { value: "glass", label: "Glass" },
  { value: "blur", label: "Blur" },
];

const POSITION_OPTIONS = Object.keys(MARK_POSITIONS) as MarkPosition[];

const formatClock = (seconds: number) => {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

const DEBUG_VIEWS: { value: Exclude<MarkView, "render">; label: string }[] = [
  // displacement red x, green y, olive no shift
  { value: "displacement", label: "Depth map" },
  { value: "clear", label: "Pure glass" },
  { value: "rim", label: "Rim only" },
];

export const Mark = () => {
  const run = useToolRun(TOOL.value);
  const source = useVideoSource();
  const formatBlocker = useFormatBlocker(source.file, { stills: true }, source.nonSquare);
  const [watermark, setWatermark] = useState<File | null>(null);
  const [filterMode, setFilterMode] = useState<MarkFilter>("glass");
  const [pickedSize, setPickedSize] = useState<Exclude<MarkSize, "dev">>("medium");
  const [position, setPosition] = useState<MarkPosition>("bottom-right");
  // Reshuffled for each export.
  const [shuffle, setShuffle] = useState<MarkPosition[] | null>(null);
  const [quality, setQuality] = useState<number>(100);
  const [previewZoomed, setPreviewZoomed] = useState(false);
  const debug = useDebugMode();
  const [debugView, setDebugView] = useState<MarkView>("render");
  const [devSize, setDevSize] = useState(false);
  const size: MarkSize = debug && devSize ? "dev" : pickedSize;
  const pickSize = (picked: MarkSize) => {
    if (picked === "dev") return;
    setPickedSize(picked);
    setDevSize(false);
  };

  const still = source.file !== null && isStillImage(source.file) && source.duration === 0;
  const route = still ? null : shuffle;
  const shuffling = route !== null;
  const preview = useMarkPreview(
    source.file,
    watermark,
    filterMode,
    size,
    position,
    route,
    debug ? debugView : "render",
  );
  const previewRef = useRef<HTMLDivElement | null>(null);

  const [markX, markY] = MARK_POSITIONS[preview.shownPosition];

  const sourceFile = source.file;

  const lossless = sourceFile !== null && stillFormat(sourceFile)?.id === "png";
  const aspectRatio = source.meta ? `${source.meta.w} / ${source.meta.h}` : "16 / 9";
  const { shownRender } = preview;

  const pickPosition = (picked: MarkPosition) => {
    setPosition(picked);
    setShuffle(null);
  };

  const pick = (picked: File[]) => {
    run.clearError();
    preview.reset();
    source.pick(picked);
  };

  const pickWatermark = ([picked]: File[]) => {
    run.clearError();
    setWatermark(picked);
  };

  const submit = () => {
    if (!source.file || !watermark) return;
    run.start({
      files: [source.file],
      extras: [{ file: watermark, status: "Uploading watermark" }],
      payload: ({ blobUrls, extraUrls }) => ({
        blobUrl: blobUrls[0],
        watermarkUrl: extraUrls[0],
        options: { filter: filterMode, size, position, route, quality },
      }),
    });
    if (route) setShuffle(shuffleRoute(position));
  };

  return (
    <ToolPanel
      tool={TOOL}
      inputs={
        <div className={styles.markInputs}>
          <Upload
            {...TOOL.input}
            files={source.file ? [source.file] : []}
            onFiles={pick}
            meta={source.meta}
          />
          <Upload
            accept={WATERMARK_ACCEPT}
            multiple={false}
            pickerLabel="choose watermark"
            files={watermark ? [watermark] : []}
            onFiles={pickWatermark}
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
      {sourceFile && hasFrames(sourceFile) && watermark && (
        <Tooltip
          content={
            preview.frameCount > 1 ? (
              <span className={styles.markPreviewTooltip}>
                <span className={styles.markPreviewClock}>
                  {formatClock(preview.shownSecond)} / {formatClock(Math.round(preview.duration))}
                </span>
                {previewZoomed ? "Zoom out" : "Zoom in"}
              </span>
            ) : (
              `${previewZoomed ? "Zoom out" : "Zoom in"}`
            )
          }
          delay={0}
          align="end"
          stretch
          render={
            <div
              ref={previewRef}
              className={`${styles.markPreviewContainer}${previewZoomed ? ` ${styles.markPreviewZoomed}` : ""}`}
              onClick={() => setPreviewZoomed((zoomed) => !zoomed)}
              style={{ aspectRatio, "--mark-x": markX, "--mark-y": markY } as CSSProperties}
            />
          }
        >
          <figure
            aria-label="watermark preview"
            aria-busy={preview.loading}
            className={styles.markPreview}
            style={{ aspectRatio }}
          >
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

            <FramePreview
              file={sourceFile}
              second={0}
              label="first frame"
              className={styles.markPreviewFrame}
            />
          </figure>
          <div className={styles.markPreviewLoading} hidden={!preview.loading}>
            <Spinner />
          </div>
          {preview.frameCount > 1 && (
            <div className={styles.markPreviewScrub} aria-hidden="true">
              {Array.from({ length: preview.frameCount }, (_, i) => (
                <div key={i} onPointerEnter={() => preview.setScrubIndex(i)} />
              ))}
            </div>
          )}
          {preview.previewError && (
            <figcaption className={styles.markPreviewNote}>Preview unavailable</figcaption>
          )}
        </Tooltip>
      )}
      {sourceFile && hasFrames(sourceFile) && watermark && (
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
        {watermark && (
          <div
            className={`${form.formGroup} ${styles.markPosition}`}
            data-shuffling={shuffling || undefined}
          >
            {/* Images can't be shuffled */}
            {still ? (
              <span id="markPosition" className={`${form.label} ${styles.markPlace}`}>
                Place
              </span>
            ) : (
              <button
                type="button"
                className={`${form.label} ${styles.markPlace}`}
                aria-label="Shuffle"
                aria-pressed={shuffle !== null}
                onClick={() => setShuffle((on) => (on ? null : shuffleRoute(position)))}
                disabled={run.busy}
              >
                <span id="markPosition" className={styles.markPlaceIdle}>
                  Place
                </span>
                <span className={styles.markPlaceShuffle}>
                  {shuffle ? "Shuffling" : "Shuffle?"}
                </span>
              </button>
            )}
            <ToggleGrid
              labelledBy="markPosition"
              options={POSITION_OPTIONS}
              value={position}
              onValueChange={pickPosition}
              disabled={run.busy}
              shuffling={shuffling}
            />
          </div>
        )}
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
            label={<>{quality === 100 ? `Lossless ${quality}%` : `Quality ${quality}%`}</>}
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
