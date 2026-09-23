import { useState } from "react";
import { ToolPanel } from "../../components/ToolPanel/ToolPanel";
import { DropZone } from "../../components/DropZone/DropZone";
import { Select } from "../../components/Select/Select";
import { NumberField } from "../../components/NumberField/NumberField";
import { Slider } from "../../components/Slider/Slider";
import { useFormatBlocker } from "../../hooks/useFormatBlocker";
import { useToolRun } from "../../hooks/useToolRun";
import type { Dims } from "../../hooks/useVideoSource";
import { toolById } from "../../tools";
import { SEQUENCE_FORMATS, formatById } from "../../../../shared/formats";
import form from "../form.module.css";

const TOOL = toolById("sequence");

// Stills have no format of their own to keep, so this tool asks for one
// (shared/formats.ts, which the functions validate against too).
const FORMATS = SEQUENCE_FORMATS.map((id) => ({
  value: id,
  label: formatById(id).label,
}));

// Rough output-size model: bytes per pixel per frame at quality 0 → 100.
// Real encoders vary wildly with content, so this is an order-of-magnitude
// estimate only.
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

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const Sequence = () => {
  const run = useToolRun(TOOL.value);
  const [files, setFiles] = useState<File[]>([]);
  // The zone takes any image (an animated one gives its first frame), but a
  // pick that mixes formats (PNG with JPEG, WebP or GIF) is in the way:
  // ffmpeg reads a sequence through one image demuxer, and frames come back
  // blank or gone.
  const formatBlocker = useFormatBlocker(files, {
    stills: true,
    foreign: false,
    oneFormat: true,
  });
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
          min={1}
          max={100}
          step={1}
          disabled={run.busy}
        />
      </div>
    </ToolPanel>
  );
};
