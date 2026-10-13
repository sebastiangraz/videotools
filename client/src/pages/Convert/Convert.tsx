import { useState } from "react";
import { ToolPanel } from "@src/components/ToolPanel/ToolPanel";
import { Upload } from "@src/components/Upload/Upload";
import { Select } from "@src/components/Select/Select";
import { NumberField } from "@src/components/NumberField/NumberField";
import { Slider } from "@src/components/Slider/Slider";
import { useFormatBlocker } from "@src/hooks/useFormatBlocker";
import { useToolRun } from "@src/hooks/useToolRun";
import { useVideoSource } from "@src/hooks/useVideoSource";
import { fileFormat, targetsFor } from "@src/sourceFormat";
import { toolById } from "@src/tools";
import { qualityLabel, toList } from "@src/helpers";
import form from "@src/form.module.css";

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
  const targetOptions = targetsFor(source.file);
  const effectiveTarget = targetOptions.some((t) => t.value === target)
    ? target
    : targetOptions[0].value;

  // WebP at 100 is lossless only from a lossless source (encode/webp.ts); of
  // those only a GIF shows by name.
  const sourceFormat = source.file ? fileFormat(source.file) : null;
  const lossless = effectiveTarget === "webp" && quality === 100 && sourceFormat?.id === "gif";

  const pick = (picked: File[]) => {
    run.clearError();
    source.pick(picked);
  };

  const submit = () => {
    if (!source.file) return;
    const options: Record<string, unknown> = { target: effectiveTarget, quality };
    if (effectiveTarget === "gif") {
      if (gifFps != null) options.fps = gifFps;
      options.width = gifWidth ?? 640;
    }
    run.start({
      files: [source.file],
      payload: ({ blobUrls }) => ({ blobUrl: blobUrls[0], options }),
    });
  };

  return (
    <ToolPanel
      tool={TOOL}
      inputs={
        <Upload {...TOOL.input} files={toList(source.file)} onFiles={pick} meta={source.meta} />
      }
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
              label={qualityLabel(quality, lossless)}
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
