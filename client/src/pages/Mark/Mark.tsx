import { useRef, useState, type CSSProperties } from "react";
import { ToolPanel } from "@src/components/ToolPanel/ToolPanel";
import { Upload } from "@src/components/Upload/Upload";
import { FramePreview } from "@src/components/FramePreview/FramePreview";
import { SliderRotary } from "@src/components/SliderRotary/SliderRotary";
import { QUALITY_KNOB } from "@src/components/SliderRotary/presets";
import { Spinner } from "@src/components/Spinner/Spinner";
import { ToggleGroup } from "@src/components/ToggleGroup/ToggleGroup";
import { ToggleGrid } from "@src/components/ToggleGrid/ToggleGrid";
import { useFormatBlocker } from "@src/hooks/useFormatBlocker";
import { useToolRun } from "@src/hooks/useToolRun";
import { useVideoSource } from "@src/hooks/useVideoSource";
import { hasFrames, isStillImage, stillFormat } from "@src/sourceFormat";
import { toolById } from "@src/tools";
import { aspectRatioOf, cx, formatClock, toList } from "@src/helpers";
import { MARK, MARK_TUNING } from "@api/tools/mark-config";
import {
  MARK_POSITIONS,
  shuffleRoute,
  useMarkPreview,
  type MarkFilter,
  type MarkPosition,
  type MarkSize,
  type MarkTuning,
  type MarkView,
} from "./useMarkPreview";
import form from "@src/form.module.css";
import styles from "./Mark.module.css";
import { Tooltip } from "@src/components/Tooltip/Tooltip";
import { Popover } from "@src/components/Popover/Popover";
import { useDebugMode } from "@src/hooks/useDebugMode";
import { Switch } from "@src/components/Switch/Switch";

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

const DEBUG_VIEWS: { value: Exclude<MarkView, "render">; label: string }[] = [
  // displacement red x, green y, olive no shift
  { value: "displacement", label: "Depth map" },
  { value: "clear", label: "Pure glass" },
  { value: "rim", label: "Rim only" },
];

const TUNED: MarkTuning = { coreGain: MARK.coreGain, thinRefract: MARK.thinRefract };
const TUNING_KNOBS = (
  [
    { key: "coreGain", label: "Core gain", step: 1 },
    { key: "thinRefract", label: "Thin refract", step: 0.01 },
  ] as const
).map(({ key, ...knob }) => {
  const [min, max] = MARK_TUNING[key];
  return { key, ...knob, min, max };
});

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
  const [tuning, setTuning] = useState(TUNED);
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
    debug ? tuning : TUNED,
  );
  const previewRef = useRef<HTMLDivElement | null>(null);

  const [markX, markY] = MARK_POSITIONS[preview.shownPosition];

  const lossless = source.file !== null && stillFormat(source.file)?.id === "png";
  const aspectRatio = aspectRatioOf(source.meta);
  const zoomLabel = previewZoomed ? "Zoom out" : "Zoom in";
  const watermarkBlocker = watermark ? null : "Upload a watermark";

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
        options: {
          filter: filterMode,
          size,
          position,
          route,
          quality,
          tuning: debug ? tuning : null,
        },
      }),
      onDone: () => route && setShuffle(shuffleRoute(position)),
    });
  };

  return (
    <ToolPanel
      tool={TOOL}
      inputs={
        <div className={styles.markInputs}>
          <Upload {...TOOL.input} files={toList(source.file)} onFiles={pick} meta={source.meta} />
          <Upload
            accept={WATERMARK_ACCEPT}
            multiple={false}
            pickerLabel="choose watermark"
            files={toList(watermark)}
            onFiles={pickWatermark}
          />
        </div>
      }
      blocker={source.file ? (formatBlocker ?? watermarkBlocker) : "Upload a file"}
      run={run}
      onSubmit={submit}
      control={
        !lossless && (
          <SliderRotary
            label={`Quality ${quality}`}
            value={quality}
            onValueChange={setQuality}
            {...QUALITY_KNOB}
            disabled={run.busy}
          />
        )
      }
    >
      {source.file && hasFrames(source.file) && watermark && (
        <>
          <Tooltip
            content={
              preview.frameCount > 1 ? (
                <span className={styles.markPreviewTooltip}>
                  <span className={styles.markPreviewClock}>
                    {formatClock(preview.shownSecond)} / {formatClock(Math.round(preview.duration))}
                  </span>
                  {zoomLabel}
                </span>
              ) : (
                zoomLabel
              )
            }
            delay={0}
            align="end"
            stretch
            render={
              <div
                ref={previewRef}
                className={cx(
                  styles.markPreviewContainer,
                  previewZoomed && styles.markPreviewZoomed,
                )}
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
                      alt={i === preview.shownRender ? "watermarked frame" : ""}
                      className={cx(
                        styles.markPreviewRender,
                        i !== preview.shownRender && styles.markPreviewFrameHidden,
                      )}
                    />
                  ),
              )}

              <FramePreview
                file={source.file}
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
            <div className={styles.rotaryRow}>
              {TUNING_KNOBS.map(({ key, label, ...range }) => (
                <SliderRotary
                  key={key}
                  label={`${label} ${tuning[key]}`}
                  value={tuning[key]}
                  onValueChange={(value) => setTuning((tuned) => ({ ...tuned, [key]: value }))}
                  {...range}
                  disabled={false}
                  showArc={false}
                  pipCount={0}
                  wheelSteps={Math.round(range.max / range.step)}
                />
              ))}
            </div>
          </Popover>
        </>
      )}
      {watermark && (
        <div className={form.horizontal}>
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
          <div
            className={cx(form.formGroup, styles.markPosition)}
            data-shuffling={shuffling || undefined}
          >
            {/* Images can't be shuffled */}
            {still ? (
              <span id="markPosition" className={cx(form.label, styles.markPlace)}>
                Place
              </span>
            ) : (
              <button
                type="button"
                className={cx(form.label, styles.markPlace)}
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
        </div>
      )}
    </ToolPanel>
  );
};
