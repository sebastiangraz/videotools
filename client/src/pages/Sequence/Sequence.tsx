import { useEffect, useState } from "react";
import { ToolPanel } from "../../components/ToolPanel/ToolPanel";
import { Upload } from "../../components/Upload/Upload";
import { FramePreview } from "../../components/FramePreview/FramePreview";
import { Select } from "../../components/Select/Select";
import { NumberField } from "../../components/NumberField/NumberField";
import { Slider } from "../../components/Slider/Slider";
import { useFormatBlocker } from "../../hooks/useFormatBlocker";
import { useToolRun } from "../../hooks/useToolRun";
import type { SourceMeta } from "../../hooks/useVideoSource";
import { byFilename } from "../../sourceFormat";
import { toolById } from "../../tools";
import { SEQUENCE_FORMATS, formatById } from "../../../../api/_lib/formats";
import form from "../form.module.css";
import { formatBytes } from "../../helpers";

const TOOL = toolById("sequence");

// Stills have no format of their own to keep, so the user picks one.
const FORMATS = SEQUENCE_FORMATS.map((id) => ({
  value: id,
  label: formatById(id).label,
}));

// Bytes per pixel per frame at quality 0 → 100: an order-of-magnitude guess.
const SIZE_BPP: Record<string, { min: number; max: number }> = {
  mp4: { min: 0.01, max: 0.15 },
  gif: { min: 0.05, max: 0.5 },
  webp: { min: 0.01, max: 0.2 },
  avif: { min: 0.004, max: 0.1 },
};

function estimateOutputBytes(
  w: number,
  h: number,
  frames: number,
  format: string,
  quality: number,
): number {
  const bpp = SIZE_BPP[format] ?? SIZE_BPP.mp4;
  const t = quality / 100;
  // The server caps the longest side at 1920
  const scale = Math.min(1, 1920 / Math.max(w, h));
  const pixels = Math.round(w * scale) * Math.round(h * scale);
  // Quality affects size superlinearly
  return pixels * frames * (bpp.min + (bpp.max - bpp.min) * t * t);
}

// The pick played at the field's pace: a FramePreview handed the next still
// every `frameDuration` seconds. Lives in the card, so it ticks only while
// that is open and starts over on the first image (the thumbnail) each time.
const SequencePreview = ({ files, frameDuration }: { files: File[]; frameDuration: number }) => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    // A cleared field reads as 0; never spin.
    const timer = setInterval(() => setTick((n) => n + 1), Math.max(0.1, frameDuration) * 1000);
    return () => clearInterval(timer);
  }, [frameDuration]);
  return <FramePreview file={files[tick % files.length]} second={0} label="sequence preview" />;
};

export const Sequence = () => {
  const run = useToolRun(TOOL.value);
  const [files, setFiles] = useState<File[]>([]);
  const formatBlocker = useFormatBlocker(files, {
    stills: true,
    foreign: false,
    oneFormat: true,
  });
  const [imageMeta, setImageMeta] = useState<SourceMeta | null>(null);
  // NumberField reports null while empty; submit falls back to the default.
  const [frameDuration, setFrameDuration] = useState<number | null>(1);
  const [format, setFormat] = useState<string>("mp4");
  const [quality, setQuality] = useState<number>(100);

  const pick = (picked: File[]) => {
    run.clearError();
    const sorted = [...picked].sort(byFilename);
    setFiles(sorted);
    setImageMeta(null);

    const first = sorted[0];
    if (first.type.startsWith("image/")) {
      // The first image sets the output frame size.
      const img = new Image();
      img.onload = () => {
        setImageMeta({ w: img.naturalWidth, h: img.naturalHeight });
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(first);
    }
  };

  const submit = () =>
    run.start({
      files,
      payload: ({ blobUrls }) => ({
        blobUrls,
        options: {
          frameDuration: frameDuration ?? 1,
          format,
          quality,
        },
      }),
    });

  return (
    <ToolPanel
      tool={TOOL}
      inputs={<Upload {...TOOL.input} files={files} onFiles={pick} meta={imageMeta} />}
      blocker={files.length > 0 ? formatBlocker : "Upload a file"}
      run={run}
      onSubmit={submit}
    >
      <div className={form.formGroup}>
        <label htmlFor="frameDuration" className={form.label}>
          Time per frame
        </label>
        <NumberField
          id="frameDuration"
          value={frameDuration}
          onValueChange={setFrameDuration}
          min={0.1}
          step={0.1}
          disabled={run.busy}
          preview={
            files.length > 0 && <SequencePreview files={files} frameDuration={frameDuration ?? 1} />
          }
        />
      </div>

      <div className={form.formGroup}>
        <label htmlFor="format" className={form.label}>
          Output format
        </label>
        <Select
          id="format"
          options={FORMATS}
          value={format}
          onValueChange={setFormat}
          disabled={run.busy}
        />
      </div>

      <div className={form.formGroup}>
        <Slider
          label={
            <>
              Quality {quality}%
              {(format === "avif" || format === "webp") && quality === 100
                ? " (lossless)"
                : files.length > 0 &&
                  imageMeta &&
                  ` ~${formatBytes(
                    estimateOutputBytes(imageMeta.w, imageMeta.h, files.length, format, quality),
                  )}`}
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
    </ToolPanel>
  );
};
