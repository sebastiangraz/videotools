import { useState } from "react";
import { ToolPanel } from "../../components/ToolPanel/ToolPanel";
import { DropZone } from "../../components/DropZone/DropZone";
import { Slider } from "../../components/Slider/Slider";
import { OutputFormat } from "../../components/OutputFormat/OutputFormat";
import { useToolRun } from "../../hooks/useToolRun";
import { useVideoSource } from "../../hooks/useVideoSource";
import { keptFormatBlocker } from "../../sourceFormat";
import { toolById } from "../../tools";
import form from "../form.module.css";

const TOOL = toolById("speed");

export const Speed = () => {
  const run = useToolRun(TOOL.value);
  const source = useVideoSource();
  const [speed, setSpeed] = useState<number>(0);

  // Signed speed ratio → playback multiplier: ±1 → 2× faster/slower,
  // ±3 → 4×. Mirrored in api/_lib/tools/speed.ts.
  const speedMultiplier = speed >= 0 ? 1 + speed : 1 / (1 - speed);

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
        options: { speed },
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
      blocker={
        source.file ? keptFormatBlocker(source.file) : "Upload a file"
      }
      run={run}
      onSubmit={submit}
    >
      {source.file && <OutputFormat file={source.file} />}

      <div className={form.formGroup}>
        <Slider
          label={
            <>
              Speed (
              {speed === 0
                ? "unchanged"
                : speed > 0
                  ? `${(1 + speed).toFixed(1)}x faster`
                  : `${(1 - speed).toFixed(1)}x slower`}
              {source.duration > 0 &&
                ` ~${(source.duration / speedMultiplier).toFixed(1)}s`}
              )
            </>
          }
          value={speed}
          onValueChange={setSpeed}
          min={-3}
          max={3}
          step={0.1}
          disabled={run.busy}
          centered
          ticks
          tickCount={6}
        />
      </div>
    </ToolPanel>
  );
};
