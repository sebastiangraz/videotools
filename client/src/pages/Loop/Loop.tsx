import { useState } from "react";
import { ToolPanel } from "../../components/ToolPanel/ToolPanel";
import { DropZone } from "../../components/DropZone/DropZone";
import { FramePreview } from "../../components/FramePreview/FramePreview";
import { Select } from "../../components/Select/Select";
import { NumberField } from "../../components/NumberField/NumberField";
import { Slider } from "../../components/Slider/Slider";
import { useToolRun } from "../../hooks/useToolRun";
import { useVideoSource } from "../../hooks/useVideoSource";
import { toolById } from "../../tools";
import form from "../form.module.css";

const TOOL = toolById("loop");

// Looping techniques. Mirrored in api/_lib/tools/loop.ts (VALID_TECHNIQUES)
const TECHNIQUES = [
  { value: "crossfade", label: "Crossfade" },
  { value: "reverse", label: "Forward & reverse" },
];

export const Loop = () => {
  const run = useToolRun(TOOL.value);
  const source = useVideoSource();
  const [technique, setTechnique] = useState<string>("crossfade");
  // NumberField reports null while its input is empty; submit falls back to
  // each field's default.
  const [fadeDuration, setFadeDuration] = useState<number | null>(0.5);
  const [startSecond, setStartSecond] = useState<number | null>(0);
  const [quality, setQuality] = useState<number>(100);

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
          startSecond: startSecond ?? 0,
          quality,
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
      blocker={source.file ? null : "Upload a file"}
      run={run}
      onSubmit={submit}
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
              value={startSecond}
              onValueChange={setStartSecond}
              min={0}
              step={0.1}
              largeStep={0.5}
              disabled={run.busy}
              preview={
                source.url && (
                  <FramePreview src={source.url} second={startSecond ?? 0} />
                )
              }
            />
          </div>
        </div>
      )}

      <div className={form.formGroup}>
        <Slider
          label={<>Quality {quality}%</>}
          value={quality}
          onValueChange={setQuality}
          min={0}
          max={100}
          step={1}
          disabled={run.busy}
          ticks
          tickCount={2}
        />
      </div>
    </ToolPanel>
  );
};
