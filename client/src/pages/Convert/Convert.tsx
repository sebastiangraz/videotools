import { useState } from "react";
import { ToolPanel } from "../../components/ToolPanel/ToolPanel";
import { Upload } from "../../components/Upload/Upload";
import { Select } from "../../components/Select/Select";
import { NumberField } from "../../components/NumberField/NumberField";
import { Slider } from "../../components/Slider/Slider";
import { useFormatBlocker } from "../../hooks/useFormatBlocker";
import { useToolRun } from "../../hooks/useToolRun";
import { useVideoSource } from "../../hooks/useVideoSource";
import { fileFormat, targetsFor } from "../../sourceFormat";
import { toolById } from "../../tools";
import form from "../form.module.css";

const TOOL = toolById("convert");

export const Convert = () => {
  const run = useToolRun(TOOL.value);
  const source = useVideoSource();
  // Foreign sources (.avi, .mkv, ...) are this tool's whole point.
  const formatBlocker = useFormatBlocker(source.file, { foreign: false }, source.nonSquare);
  const [target, setTarget] = useState<string>("mp4");
  const [quality, setQuality] = useState<number>(100);
  // null = match the source framerate (the server probes it, capped at 30)
  const [gifFps, setGifFps] = useState<number | null>(null);
  // NumberField reports null while empty; submit falls back to the default.
  const [gifWidth, setGifWidth] = useState<number | null>(640);

  // `target` survives a file swap; if the new source claims it, fall to the
  // first remaining option.
  const sourceFormat = source.file ? fileFormat(source.file) : null;
  const targetOptions = targetsFor(source.file);
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
      inputs={<Upload {...TOOL.input} files={source.file ? [source.file] : []} onFiles={pick} />}
      blocker={source.file ? formatBlocker : "Upload a file"}
      run={run}
      onSubmit={submit}
    >
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
                      (encode/webp.ts); of those only a GIF shows by name. */}
                  {effectiveTarget === "webp" && quality === 100 && sourceFormat?.id === "gif"
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
