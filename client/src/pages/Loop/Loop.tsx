import { useState } from "react";
import { ToolPanel } from "@src/components/ToolPanel/ToolPanel";
import { Upload } from "@src/components/Upload/Upload";
import { FramePreview } from "@src/components/FramePreview/FramePreview";
import { Select } from "@src/components/Select/Select";
import { NumberField } from "@src/components/NumberField/NumberField";
import { SliderRotary } from "@src/components/SliderRotary/SliderRotary";
import { useFormatBlocker } from "@src/hooks/useFormatBlocker";
import { useToolRun } from "@src/hooks/useToolRun";
import { clampStart, maxStart, useVideoSource } from "@src/hooks/useVideoSource";
import { hasFrames } from "@src/sourceFormat";
import { toolById } from "@src/tools";
import { toList } from "@src/helpers";
import form from "@src/form.module.css";

const TOOL = toolById("loop");

// Mirrored in api/_lib/tools/loop.ts (VALID_TECHNIQUES)
const TECHNIQUES = [
  { value: "crossfade", label: "Crossfade" },
  { value: "reverse", label: "Forward & reverse" },
];

export const Loop = () => {
  const run = useToolRun(TOOL.value);
  const source = useVideoSource();
  const formatBlocker = useFormatBlocker(source.file, {}, source.nonSquare);
  const [technique, setTechnique] = useState<string>("crossfade");
  // NumberField reports null while empty; submit falls back to the default.
  const [fadeDuration, setFadeDuration] = useState<number | null>(0.5);
  const [startSecond, setStartSecond] = useState<number | null>(0);
  const [quality, setQuality] = useState<number>(100);
  // The server clamps to the clip as well.
  const start = clampStart(startSecond, source.duration);

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
          technique,
          fadeDuration: fadeDuration ?? 0.5,
          startSecond: start ?? 0,
          quality,
        },
      }),
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
      control={
        <SliderRotary
          label={`Quality ${quality}`}
          value={quality}
          onValueChange={setQuality}
          min={0}
          max={100}
          step={1}
          disabled={run.busy}
          showArc={true}
        />
      }
    >
      <div className={form.formGroup}>
        <label htmlFor="technique" className={form.label}>
          Technique
        </label>
        <Select
          id="technique"
          options={TECHNIQUES}
          value={technique}
          onValueChange={setTechnique}
          disabled={run.busy}
        />
      </div>

      {technique === "crossfade" && (
        <div className={form.horizontal}>
          <div className={form.formGroup}>
            <label htmlFor="fadeDuration" className={form.label}>
              Fade Duration
            </label>
            <NumberField
              id="fadeDuration"
              value={fadeDuration}
              onValueChange={setFadeDuration}
              min={0}
              step={0.1}
              largeStep={0.5}
              disabled={run.busy}
            />
          </div>
          <div className={form.formGroup}>
            <label htmlFor="startSecond" className={form.label}>
              Start at
            </label>
            <NumberField
              id="startSecond"
              value={start}
              onValueChange={setStartSecond}
              min={0}
              max={maxStart(source.duration)}
              step={0.1}
              largeStep={0.5}
              disabled={run.busy}
              preview={
                source.file &&
                hasFrames(source.file) && <FramePreview file={source.file} second={start ?? 0} />
              }
            />
          </div>
        </div>
      )}
    </ToolPanel>
  );
};
