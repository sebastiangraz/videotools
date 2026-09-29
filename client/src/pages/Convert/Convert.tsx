import { useState } from "react";
import { ToolPanel } from "../../components/ToolPanel/ToolPanel";
import { DropZone } from "../../components/DropZone/DropZone";
import { Select } from "../../components/Select/Select";
import { NumberField } from "../../components/NumberField/NumberField";
import { Slider } from "../../components/Slider/Slider";
import { useFormatBlocker } from "../../hooks/useFormatBlocker";
import { useToolRun } from "../../hooks/useToolRun";
import { useVideoSource } from "../../hooks/useVideoSource";
import { fileFormat } from "../../sourceFormat";
import { toolById } from "../../tools";
import { FORMATS } from "../../../../shared/formats";
import form from "../form.module.css";

const TOOL = toolById("convert");

// Every format the app writes (shared/formats.ts, which the functions'
// encoders follow too). GIF is encoded by gifski server-side, the rest by
// ffmpeg — the dropdown deliberately doesn't distinguish.
const CONVERT_TARGETS = FORMATS.map((f) => ({ value: f.id, label: f.label }));

export const Convert = () => {
  const run = useToolRun(TOOL.value);
  const source = useVideoSource();
  // Foreign sources (.avi, .mkv, ...) are this tool's whole point, so no
  // file ffmpeg reads is turned away for its format.
  const formatBlocker = useFormatBlocker(
    source.file,
    { foreign: false },
    source.nonSquare,
  );
  const [target, setTarget] = useState<string>("mp4");
  const [quality, setQuality] = useState<number>(100);
  // null = match the source framerate (the server probes it, capped at 30)
  const [gifFps, setGifFps] = useState<number | null>(null);
  // NumberField reports null while its input is empty; submit falls back to
  // the default.
  const [gifWidth, setGifWidth] = useState<number | null>(640);

  // Convert targets minus the picked file's own format: every other tool
  // already hands that one back. Sources in no format of the app's (.avi,
  // .mkv, ...) keep the full list. `target` survives a file swap; if the new
  // source claims it, fall to the first remaining option instead of
  // resetting state.
  const sourceFormat = source.file ? fileFormat(source.file) : null;
  const targetOptions = CONVERT_TARGETS.filter(
    (t) => t.value !== sourceFormat?.id,
  );
  const effectiveTarget = targetOptions.some((t) => t.value === target)
    ? target
    : targetOptions[0].value;

  const pick = (picked: File[]) => {
    run.clearError();
    source.pick(picked);
  };

  const submit = () => {
    if (!source.file) return;
    run.start({
      files: [source.file],
      payload: ({ blobUrls }) => ({
        blobUrl: blobUrls[0],
        options: {
          target: effectiveTarget,
          quality,
          ...(effectiveTarget === "gif"
            ? {
                // fps stays home when empty: the server then matches the
                // source framerate
                ...(gifFps != null ? { fps: gifFps } : {}),
                width: gifWidth ?? 640,
              }
            : {}),
        },
      }),
    });
  };

  return (
    <ToolPanel
      tool={TOOL}
      inputs={
        <DropZone
          {...TOOL.input}
          files={source.file ? [source.file] : []}
          onFiles={pick}
        />
      }
      blocker={source.file ? formatBlocker : "Upload a file"}
      run={run}
      onSubmit={submit}
    >
      {/* The dropdown waits for a file: its options depend on the picked
          file's format (a source isn't offered as its own target). */}
      {source.file && (
        <>
          <div className={form.formGroup}>
            <label htmlFor="target" className={form.label}>
              Convert to
            </label>
            <Select
              id="target"
              options={targetOptions}
              value={effectiveTarget}
              onValueChange={setTarget}
              disabled={run.busy}
            />
          </div>

          {effectiveTarget === "gif" && (
            <div className={form.horizontal}>
              <div className={form.formGroup}>
                <label htmlFor="gifFps" className={form.label}>
                  FPS
                </label>
                <NumberField
                  id="gifFps"
                  value={gifFps}
                  onValueChange={setGifFps}
                  min={1}
                  max={30}
                  step={1}
                  largeStep={5}
                  disabled={run.busy}
                  format={{ maximumFractionDigits: 0 }}
                  placeholder="source"
                />
              </div>

              <div className={form.formGroup}>
                <label htmlFor="gifWidth" className={form.label}>
                  Width (px)
                </label>
                <NumberField
                  id="gifWidth"
                  value={gifWidth}
                  onValueChange={setGifWidth}
                  min={100}
                  max={800}
                  step={20}
                  largeStep={100}
                  disabled={run.busy}
                  format={{ maximumFractionDigits: 0, useGrouping: false }}
                />
              </div>
            </div>
          )}

          <div className={form.formGroup}>
            <Slider
              label={
                <>
                  {/* WebP at 100 is lossless only from a lossless source
                      (api/_lib/encode/webp.ts); of those, only a GIF shows
                      by its name. */}
                  {effectiveTarget === "webp" &&
                  quality === 100 &&
                  sourceFormat?.id === "gif"
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
        </>
      )}
    </ToolPanel>
  );
};
