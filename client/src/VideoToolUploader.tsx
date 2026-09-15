import { useEffect, useRef, useState, ChangeEvent, DragEvent } from "react";
import { upload } from "@vercel/blob/client";
import styles from "./VideoToolUploader.module.css";
import { VersionLabel } from "./VersionLabel";
import { Select } from "./components/Select/Select";
import { NumberField } from "./components/NumberField/NumberField";
import { Slider } from "./components/Slider/Slider";
import { Tooltip } from "./components/Tooltip/Tooltip";

const VIDEO_ACCEPT =
  "video/*,.avi,.mkv,.mov,.webm,.m4v,.wmv,.mpg,.mpeg,.3gp,.ts";

// Available tools. Mirrored in api/process.ts (VALID_TOOLS); each tool's
// extra options are the conditional blocks in the JSX below. Also drives
// the routes and tab navigation in App.tsx, where `description` fills the
// tab's preview card (keep it under 100 characters).
export const TOOLS = [
  {
    value: "loop",
    label: "Loop",
    description: "Seamlessly loop a video",
    input: {
      accept: VIDEO_ACCEPT,
      multiple: false,
      pickerLabel: "choose video",
    },
    actionLabel: "Loop",
  },
  {
    value: "sequence",
    label: "Sequence",
    description: "Convert images to video",
    input: { accept: "image/*", multiple: true, pickerLabel: "choose images" },
    actionLabel: "Create video",
  },
  {
    value: "speed",
    label: "Speed",
    description: "Change video speed",
    input: {
      accept: VIDEO_ACCEPT,
      multiple: false,
      pickerLabel: "choose video",
    },
    actionLabel: "Change speed",
  },
  {
    value: "convert",
    label: "Convert",
    description: "Convert a video to another format",
    input: {
      accept: VIDEO_ACCEPT,
      multiple: false,
      pickerLabel: "choose video",
    },
    actionLabel: "Convert",
  },
];

// Looping techniques for the "loop" tool. Mirrored in api/process.ts
// (VALID_TECHNIQUES)
const TECHNIQUES = [
  { value: "crossfade", label: "Crossfade" },
  { value: "reverse", label: "Forward & reverse" },
];

// Mirrored in api/process.ts (VALID_FORMATS)
const FORMATS = [
  { value: "mp4", label: "MP4" },
  { value: "gif", label: "GIF" },
  { value: "avif", label: "AVIF" },
];

// Targets for the "convert" tool. Mirrored in api/process.ts
// (CONVERT_TARGETS). GIF is encoded by gifski server-side, the rest by
// ffmpeg — the dropdown deliberately doesn't distinguish.
const CONVERT_TARGETS = [
  { value: "mp4", label: "MP4" },
  { value: "webm", label: "WebM" },
  { value: "mov", label: "MOV" },
  { value: "gif", label: "GIF" },
  { value: "webp", label: "WebP" },
  { value: "avif", label: "AVIF" },
];

// Extensions that map onto a convert target, so the source's own format can
// be left out of the dropdown. Unknown extensions (.avi, .mkv, ...) keep the
// full list.
const EXT_TO_FORMAT: Record<string, string> = {
  mp4: "mp4",
  m4v: "mp4",
  mov: "mov",
  qt: "mov",
  webm: "webm",
};

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

// Dropped files skip the native picker's accept filtering, so mirror it:
// entries are either MIME patterns ("video/*") or bare extensions (".mkv").
function matchesAccept(file: File, accept: string): boolean {
  return accept.split(",").some((entry) => {
    const pattern = entry.trim().toLowerCase();
    if (pattern.startsWith("."))
      return file.name.toLowerCase().endsWith(pattern);
    if (pattern.endsWith("/*"))
      return file.type.startsWith(pattern.slice(0, -1));
    return file.type === pattern;
  });
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Paused <video> seeked to the loop start, shown while choosing "Start at" —
// usually the frame that becomes a social post's thumbnail. The seek waits
// for metadata so it lands on a decodable frame; the browser clamps
// out-of-range times to the clip length. The accept list is broader than
// what browsers can decode (server-side ffmpeg handles the rest), so a
// decode error swaps the frame for a short note. Tracking the failed src
// rather than a boolean resets the error when a new file is picked.
const FramePreview = ({ src, second }: { src: string; second: number }) => {
  const ref = useRef<HTMLVideoElement>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const seek = () => {
      video.currentTime = second;
    };
    if (video.readyState >= video.HAVE_METADATA) seek();
    else video.addEventListener("loadedmetadata", seek, { once: true });
    return () => video.removeEventListener("loadedmetadata", seek);
  }, [second]);

  if (failedSrc === src) {
    return (
      <p className={`${styles.framePreview} ${styles.framePreviewError}`}>
        Can&rsquo;t preview this format.
      </p>
    );
  }

  return (
    <video
      ref={ref}
      src={src}
      muted
      playsInline
      preload="auto"
      aria-label="start frame preview"
      onError={() => setFailedSrc(src)}
      className={styles.framePreview}
    />
  );
};

// The route remounts this component (keyed by tool) on tab change, so all
// state — picked files included — resets, like the old dropdown reset did.
export const VideoToolUploader = ({ tool }: { tool: string }) => {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setMsg] = useState<string>("");
  const [busy, setBusy] = useState(false);
  // Underlying failure text, shown inside the expandable error box below the
  // CTA. Null = no box.
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [technique, setTechnique] = useState<string>("crossfade");
  // NumberField reports null while its input is empty; submit falls back to
  // each field's default.
  const [fadeDuration, setFadeDuration] = useState<number | null>(0.5);
  const [startSecond, setStartSecond] = useState<number | null>(0);
  const [frameDuration, setFrameDuration] = useState<number | null>(1);
  const [format, setFormat] = useState<string>("mp4");
  const [quality, setQuality] = useState<number>(100);
  const [speed, setSpeed] = useState<number>(0);
  const [target, setTarget] = useState<string>("mp4");
  // null = match the source framerate (the server probes it, capped at 30)
  const [gifFps, setGifFps] = useState<number | null>(null);
  const [gifWidth, setGifWidth] = useState<number | null>(640);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [imageDims, setImageDims] = useState<{ w: number; h: number } | null>(
    null,
  );

  // Object URL for the picked video, shared by the duration probe and the
  // start-frame preview. Revoked when replaced or on unmount.
  useEffect(() => {
    if (!videoUrl) return;
    return () => URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  const currentTool = TOOLS.find((t) => t.value === tool) ?? TOOLS[0];

  // Signed speed ratio → playback multiplier: ±1 → 2× faster/slower,
  // ±3 → 4×. Mirrored in api/process.ts.
  const speedMultiplier = speed >= 0 ? 1 + speed : 1 / (1 - speed);

  // Convert targets minus the picked file's own format. `target` survives a
  // file swap; if the new source claims it, fall to the first remaining
  // option instead of resetting state.
  const srcExt = files[0]?.name.split(".").pop()?.toLowerCase() ?? "";
  const targetOptions = CONVERT_TARGETS.filter(
    (t) => t.value !== EXT_TO_FORMAT[srcExt],
  );
  const effectiveTarget = targetOptions.some((t) => t.value === target)
    ? target
    : targetOptions[0].value;

  const addFiles = (picked: File[]) => {
    setErrorDetail(null);
    // Frame order for image sequences follows the filenames (natural sort,
    // so img2 sorts before img10).
    const sorted = [...picked].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
    setFiles(sorted);
    setVideoDuration(0);
    setVideoUrl("");
    setImageDims(null);

    const first = sorted[0];
    if (!currentTool.input.multiple && first.type.startsWith("video/")) {
      const url = URL.createObjectURL(first);
      setVideoUrl(url);
      // Get video duration when a single video is selected
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        setVideoDuration(Math.floor(video.duration));
      };
      video.src = url;
    } else if (first.type.startsWith("image/")) {
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

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length) addFiles(picked);
  };

  // Drag enter/leave also fire on the drop zone's children, so a plain
  // boolean would flicker off mid-drag; the depth counter only clears once
  // the drag truly leaves the zone.
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const dragEnter = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };

  const dragLeave = () => {
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  };

  const drop = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files).filter((f) =>
      matchesAccept(f, currentTool.input.accept),
    );
    if (!dropped.length) return;
    addFiles(currentTool.input.multiple ? dropped : dropped.slice(0, 1));
  };

  const submit = async () => {
    // The button is only aria-disabled, so unusable states are rejected here
    // rather than by the browser
    if (!files.length || busy) return;
    setBusy(true);
    setErrorDetail(null);

    try {
      const blobUrls: string[] = [];
      for (let i = 0; i < files.length; i++) {
        setMsg(
          files.length > 1 ? `Uploading ${i + 1}/${files.length}` : "Uploading",
        );
        const blob = await upload(files[i].name, files[i], {
          access: "public",
          handleUploadUrl: "/api/upload",
          // Browsers report no type for some containers (.avi, .mkv on
          // certain systems); fall back so the upload token isn't refused.
          contentType: files[i].type || "application/octet-stream",
        });
        blobUrls.push(blob.url);
      }

      setMsg("Processing");
      const payload =
        tool === "sequence"
          ? {
              blobUrls,
              options: {
                frameDuration: frameDuration ?? 1,
                format,
                quality,
              },
            }
          : tool === "speed"
            ? { blobUrl: blobUrls[0], options: { speed } }
            : tool === "convert"
              ? {
                  blobUrl: blobUrls[0],
                  options: {
                    target: effectiveTarget,
                    quality,
                    ...(effectiveTarget === "gif"
                      ? {
                          // fps stays home when empty: the server then
                          // matches the source framerate
                          ...(gifFps != null ? { fps: gifFps } : {}),
                          width: gifWidth ?? 640,
                        }
                      : {}),
                  },
                }
              : {
                  blobUrl: blobUrls[0],
                  options: {
                    technique,
                    fadeDuration: fadeDuration ?? 0.5,
                    startSecond: startSecond ?? 0,
                    quality,
                  },
                };
      const res = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool,
          filename: files[0].name,
          ...payload,
        }),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(
          errorData?.error || `Server error (${res.status}): Unable to process`,
        );
      }
      const { url, filename: resultName } = await res.json();
      const downloadName =
        resultName || files[0].name.replace(/\.[^.]+$/, "") + "_loop.mp4";

      setMsg(`Downloading ${downloadName}`);
      // Result lives on Blob storage (cross-origin), where the anchor
      // `download` attribute is ignored — fetch to an object URL instead.
      const fileRes = await fetch(url);
      if (!fileRes.ok)
        throw new Error(`Failed to download result (${fileRes.status})`);
      const objectUrl = URL.createObjectURL(await fileRes.blob());
      const a = Object.assign(document.createElement("a"), {
        href: objectUrl,
        download: downloadName,
      });
      a.click();
      URL.revokeObjectURL(objectUrl);

      fetch("/api/process", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      }).catch(() => {});
    } catch (err: unknown) {
      console.error(err);
      // The status message only renders inside the button while busy, so
      // failures surface through the error box instead.
      setErrorDetail(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={styles.container}>
        {/* One element serves both entry paths: as a <label> around the
            (visually hidden) file input a click anywhere on it opens the
            native picker, and the drag handlers make the same surface the
            drop target. The input keeps the aria-label, so the zone is
            announced — and tested — through it. */}
        <label
          className={`${styles.dropZone}${dragging ? ` ${styles.dropZoneActive}` : ""}`}
          onDragEnter={dragEnter}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={dragLeave}
          onDrop={drop}
        >
          <input
            aria-label={currentTool.input.pickerLabel}
            type="file"
            accept={currentTool.input.accept}
            multiple={currentTool.input.multiple}
            onChange={pick}
            className={styles.dropZoneInput}
          />
          {files.length > 0 ? (
            <span className={styles.dropZoneFile}>
              {files.length === 1 ? files[0].name : `${files.length} files`}
            </span>
          ) : (
            <span className={styles.dropZoneLabel}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 8 8"
              >
                <path
                  fill="currentColor"
                  d="M4.354 2.356v4.641h-.707v-4.64L1.5 4.502l-.5-.5 3-3 3 3-.5.5z"
                />
              </svg>

              <span>{currentTool.input.pickerLabel}</span>
            </span>
          )}
          <span className={styles.dropZoneHint}>
            {files.length > 0 ? "click/drop to replace" : "or drop it here"}
          </span>
        </label>
      </div>

      <div className={styles.container}>
        {tool === "loop" && (
          <>
            <div className={styles.formGroup}>
              <label htmlFor="technique" className={styles.label}>
                Technique
              </label>
              <Select
                id="technique"
                options={TECHNIQUES}
                value={technique}
                onValueChange={setTechnique}
                disabled={busy}
              />
            </div>

            {technique === "crossfade" && (
              <div className={styles.horizontal}>
                <div className={styles.formGroup}>
                  <label htmlFor="fadeDuration" className={styles.label}>
                    Fade Duration
                  </label>
                  <NumberField
                    id="fadeDuration"
                    value={fadeDuration}
                    onValueChange={setFadeDuration}
                    min={0}
                    step={0.1}
                    largeStep={0.5}
                    disabled={busy}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="startSecond" className={styles.label}>
                    Start at
                  </label>
                  <NumberField
                    id="startSecond"
                    value={startSecond}
                    onValueChange={setStartSecond}
                    min={0}
                    step={0.1}
                    largeStep={0.5}
                    disabled={busy}
                    preview={
                      videoUrl && (
                        <FramePreview
                          src={videoUrl}
                          second={startSecond ?? 0}
                        />
                      )
                    }
                  />
                </div>
              </div>
            )}

            <div className={styles.formGroup}>
              <Slider
                label={<>Quality {quality}%</>}
                value={quality}
                onValueChange={setQuality}
                min={0}
                max={100}
                step={1}
                disabled={busy}
                ticks
                tickCount={2}
              />
            </div>
          </>
        )}

        {tool === "speed" && (
          <div className={styles.formGroup}>
            <Slider
              label={
                <>
                  Speed (
                  {speed === 0
                    ? "unchanged"
                    : speed > 0
                      ? `${(1 + speed).toFixed(1)}x faster`
                      : `${(1 - speed).toFixed(1)}x slower`}
                  {videoDuration > 0 &&
                    ` ~${(videoDuration / speedMultiplier).toFixed(1)}s`}
                  )
                </>
              }
              value={speed}
              onValueChange={setSpeed}
              min={-3}
              max={3}
              step={0.1}
              disabled={busy}
              centered
              ticks
            />
          </div>
        )}

        {tool === "sequence" && (
          <>
            <div className={styles.formGroup}>
              <label htmlFor="frameDuration" className={styles.label}>
                Time per frame
              </label>
              <NumberField
                id="frameDuration"
                value={frameDuration}
                onValueChange={setFrameDuration}
                min={0.1}
                step={0.1}
                disabled={busy}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="format" className={styles.label}>
                Output format
              </label>
              <Select
                id="format"
                options={FORMATS}
                value={format}
                onValueChange={setFormat}
                disabled={busy}
              />
            </div>

            <div className={styles.formGroup}>
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
                disabled={busy}
              />
            </div>
          </>
        )}

        {/* The dropdown waits for a file: its options depend on the picked
            file's format (a source isn't offered as its own target). */}
        {tool === "convert" && files.length > 0 && (
          <>
            <div className={styles.formGroup}>
              <label htmlFor="target" className={styles.label}>
                Convert to
              </label>
              <Select
                id="target"
                options={targetOptions}
                value={effectiveTarget}
                onValueChange={setTarget}
                disabled={busy}
              />
            </div>

            {effectiveTarget === "gif" && (
              <div className={styles.horizontal}>
                <div className={styles.formGroup}>
                  <label htmlFor="gifFps" className={styles.label}>
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
                    disabled={busy}
                    format={{ maximumFractionDigits: 0 }}
                    placeholder="source"
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="gifWidth" className={styles.label}>
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
                    disabled={busy}
                    format={{ maximumFractionDigits: 0, useGrouping: false }}
                  />
                </div>
              </div>
            )}

            <div className={styles.formGroup}>
              <Slider
                label={
                  <>
                    Quality {quality}%
                    {effectiveTarget === "webp" &&
                      quality === 100 &&
                      " (lossless)"}
                  </>
                }
                value={quality}
                onValueChange={setQuality}
                min={0}
                max={100}
                step={1}
                disabled={busy}
              />
            </div>
          </>
        )}

        {/* {videoDuration > 0 && (
          <small className={styles.label}>
            Video length: {videoDuration} seconds
          </small>
        )} */}
        {/* A natively disabled button dispatches no pointer events, so the
            tooltip explaining why it can't be pressed would never open. It
            carries aria-disabled instead, which leaves it hoverable and in
            the tab order; submit() rejects the unusable states. The tooltip
            only speaks for the missing-file case, so it's switched off once
            files are picked (the button is also disabled while busy). */}
        <Tooltip
          disabled={files.length > 0}
          content="Upload a file"
          render={
            <button
              onClick={submit}
              aria-disabled={!files.length || busy}
              className={styles.button}
            />
          }
        >
          {busy ? status && status : currentTool.actionLabel}
          {busy && <div className={styles.spinner} />}
        </Tooltip>

        {errorDetail && (
          <div role="alert" className={styles.errorBox}>
            <details>
              <summary className={styles.errorSummary}>
                <span>You broke it my dude.</span>
              </summary>
              <p className={styles.errorDetail}>{errorDetail}</p>
            </details>
          </div>
        )}

        <div className={styles.credits}>
          <div className={styles.creditsGroup}>
            <a
              href="https://graz.io"
              target="_blank"
              aria-label="logo"
              className={styles.logoLink}
            >
              G
            </a>
            <VersionLabel />
          </div>
          <label className={styles.themeSwitch}>
            <input
              type="checkbox"
              aria-label="Toggle dark mode"
              defaultChecked={document.documentElement.hasAttribute(
                "data-theme-invert",
              )}
              onChange={(e) => {
                document.documentElement.toggleAttribute(
                  "data-theme-invert",
                  e.target.checked,
                );
                localStorage.setItem(
                  "theme-invert",
                  e.target.checked ? "1" : "0",
                );
              }}
            />
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 0C18.6274 0 24 5.37258 24 12C24 18.6274 18.6274 24 12 24C5.37258 24 0 18.6274 0 12C0 5.37258 5.37258 0 12 0ZM12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4V20Z"
                fill="currentColor"
              />
            </svg>
          </label>
        </div>
      </div>
    </>
  );
};
