import { useState } from "react";
import { ToolPanel } from "../../components/ToolPanel/ToolPanel";
import { DropZone } from "../../components/DropZone/DropZone";
import { Select } from "../../components/Select/Select";
import { NumberField } from "../../components/NumberField/NumberField";
import { Slider } from "../../components/Slider/Slider";
import { useToolRun } from "../../hooks/useToolRun";
import type { Dims } from "../../hooks/useVideoSource";
import { toolById } from "../../tools";
import form from "../form.module.css";

const TOOL = toolById("sequence");

// Mirrored in api/process.ts (VALID_FORMATS)
const FORMATS = [
  { value: "mp4", label: "MP4" },
  { value: "gif", label: "GIF" },
  { value: "avif", label: "AVIF" },
];

// Rough output-size model: bytes per pixel per frame at quality 0 → 100.
// Real encoders vary wildly with content, so this is an order-of-magnitude
// estimate only.
const SIZE_BPP: Record<string, { min: number; max: number }> = {
  mp4: { min: 0.01, max: 0.15 },
  gif: { min: 0.05, max: 0.5 },
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

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const Sequence = () => {
  const run = useToolRun(TOOL.value);
  const [files, setFiles] = useState<File[]>([]);
  const [imageDims, setImageDims] = useState<Dims | null>(null);
  // NumberField reports null while its input is empty; submit falls back to
  // the default.
  const [frameDuration, setFrameDuration] = useState<number | null>(1);
  const [format, setFormat] = useState<string>("mp4");
  const [quality, setQuality] = useState<number>(100);

  const pick = (picked: File[]) => {
    run.clearError();
    // Frame order follows the filenames (natural sort, so img2 sorts before
    // img10).
    const sorted = [...picked].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
    setFiles(sorted);
    setImageDims(null);

    const first = sorted[0];
    if (first.type.startsWith("image/")) {
      // First image's dimensions drive the output frame size (and the
      // size estimate)
      const img = new Image();
      img.onload = () => {
        setImageDims({ w: img.naturalWidth, h: img.naturalHeight });
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
      inputs={<DropZone {...TOOL.input} files={files} onFiles={pick} />}
      blocker={files.length > 0 ? null : "Upload a file"}
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
              {format === "avif" && quality === 100
                ? " (lossless)"
                : files.length > 0 &&
                  imageDims &&
                  ` ~${formatBytes(
                    estimateOutputBytes(
                      imageDims.w,
                      imageDims.h,
                      files.length,
                      format,
                      quality,
                    ),
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
