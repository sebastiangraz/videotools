// Mark's grids: every clip becomes one tile of a grid, cropped to a region up
// to ZOOM_OUT× the tile's size, scaled down into it and looped to the grid's
// length. That length is split into equal slots, each slot of each tile marked
// by its own Mark run: each logo in turn, through each look in turn.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MARK_SIZES } from "../../api/_lib/tools/mark-config.ts";

const ZOOM_OUT = 2;
const FPS = 30;
const MAX_CANVAS = { width: 1920, height: 1200 };

const SCALES = [6, 3];
const LOGO_SECONDS = 2;
// Each grid's options per slot, one grid per subfolder; a logo's looks share its seconds.
const MARK_LOOKS = {
  glass: SCALES.map((scale) => {
    const size = `smoke${scale}`;
    MARK_SIZES[size] = { ...MARK_SIZES.dev, scale, uncapped: true };
    return { size };
  }),
  debug: ["clear", "rim"].map((view) => ({ size: `smoke${SCALES[0]}`, view })),
  depthmap: [{ size: `smoke${SCALES[0]}`, view: "displacement" }],
};
const OPTIONS = { filter: "glass", position: "center", quality: 100 };
const MARK_VIDEOS = [
  "abstract.mp4",
  "banana.mp4",
  "bokeh.mp4",
  "checker.mp4",
  "colorcircle.mp4",
  "gradient.mp4",
  "nature.mp4",
  "paint.mp4",
  "radial.mp4",
  "repeatgradient.mp4",
  "ui.mp4",
  "video.mp4",
];

const LIGHT_VIDEOS = ["accel.mp4", "pair.mp4", "pulse.mp4", "sweep.mp4"];
// Mark runs at once; each ffmpeg is multithreaded already.
export const CONCURRENCY = Math.max(1, Math.floor(os.availableParallelism() / 4));

export async function markGrid({ assets, outDir, ...suite }) {
  const { videos, vectors } = assets;
  for (const [dir, looks] of Object.entries(MARK_LOOKS)) {
    await grid(
      { ...suite, outDir: path.join(outDir, dir) },
      { name: "mark", videos: videos(MARK_VIDEOS), vectors, looks, slot: LOGO_SECONDS / looks.length },
    );
  }
  return outDir;
}

export function lightGrid({ assets, ...suite }) {
  const { videos, vectors } = assets;
  return grid(suite, {
    name: "light",
    videos: videos(LIGHT_VIDEOS),
    vectors: vectors.slice(0, 1),
    looks: [{ size: "dev" }],
  });
}

const floorEven = (n) => 2 * Math.floor(n / 2);

// floor(√n) rows; any remainder widens the last rows by a column each (10 → 3, 3, 4).
function gridRows(n) {
  const rows = Math.floor(Math.sqrt(n));
  const cols = Math.floor(n / rows);
  const wider = n % rows;
  return Array.from({ length: rows }, (_, r) => cols + (r >= rows - wider ? 1 : 0));
}

// `count` even sizes adding up to the even `total`, at most 2 apart.
function split(total, count) {
  const base = floorEven(total / count);
  const bigger = (total - base * count) / 2;
  return Array.from({ length: count }, (_, i) => base + (i < bigger ? 2 : 0));
}

const offsets = (sizes) => sizes.map((_, i) => sizes.slice(0, i).reduce((a, b) => a + b, 0));

// Tile rectangles in reading order. The canvas is capped so the widest and
// tallest tile still fit inside the smallest clip.
function gridTiles(n, smallest) {
  const rows = gridRows(n);
  const width = Math.min(MAX_CANVAS.width, Math.min(...rows) * floorEven(smallest.width));
  const height = Math.min(MAX_CANVAS.height, rows.length * floorEven(smallest.height));
  const heights = split(height, rows.length);
  const ys = offsets(heights);
  const tiles = rows.flatMap((cols, r) => {
    const widths = split(width, cols);
    const xs = offsets(widths);
    return widths.map((w, c) => ({ x: xs[c], y: ys[r], width: w, height: heights[r] }));
  });
  return { width, height, tiles };
}

export async function pool(items, limit, run) {
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await run(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// `slot` in seconds; without one, a single slot as long as the longest clip.
async function grid(
  { ff, outDir, runTool, say, progress },
  { name, videos, vectors, looks, slot },
) {
  if (!videos.length || !vectors.length) throw new Error("needs clips and vectors");
  const infos = await Promise.all(videos.map((file) => ff.mediaInfo(file)));
  const smallest = {
    width: Math.min(...infos.map((i) => i.width)),
    height: Math.min(...infos.map((i) => i.height)),
  };
  const { width, height, tiles } = gridTiles(videos.length, smallest);
  slot ??= Math.max(...infos.map((i) => i.duration));
  const slots = vectors.length * looks.length;
  const duration = slots * slot;
  say(
    `${name}: ${videos.length} videos × ${vectors.length} vectors → ${width}x${height} at up to ${ZOOM_OUT}× out, ${duration}s`,
  );
  // Per tile one cut, one Mark run per slot, then the stack.
  const tick = progress(videos.length * (1 + slots) + 1);

  // Each clip cropped to its tile, looped to length, cut into one part per
  // slot (keyframes at the cuts, so the parts are frame-exact).
  const tileDirs = videos.map((_, i) => path.join(outDir, `tile${i}`));
  await pool(videos, CONCURRENCY, async (video, i) => {
    fs.mkdirSync(tileDirs[i], { recursive: true });
    const { width: w, height: h } = tiles[i];
    const zoom = Math.min(ZOOM_OUT, infos[i].width / w, infos[i].height / h);
    const crop = `crop=${floorEven(w * zoom)}:${floorEven(h * zoom)}`;
    await ff.runFFmpeg([
      "-y",
      "-stream_loop",
      "-1",
      "-i",
      video,
      "-t",
      String(duration),
      "-an",
      "-vf",
      `fps=${FPS},${crop},scale=${w}:${h}:flags=lanczos,setsar=1`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "10",
      // With B-frames the segment muxer misses the first cut.
      "-bf",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-force_key_frames",
      `expr:gte(t,n_forced*${slot})`,
      "-f",
      "segment",
      "-segment_time",
      String(slot),
      "-reset_timestamps",
      "1",
      path.join(tileDirs[i], "part%d.mp4"),
    ]);
    tick();
  });

  const runs = videos.flatMap((video, t) =>
    Array.from({ length: slots }, (_, k) => ({
      video,
      t,
      k,
      vector: vectors[Math.floor(k / looks.length)],
      look: looks[k % looks.length],
    })),
  );
  const marked = await pool(runs, CONCURRENCY, async ({ video, t, k, vector, look }) => {
    const part = path.join(tileDirs[t], `part${k}.mp4`);
    const workDir = path.join(tileDirs[t], String(k));
    try {
      const { outputPath } = await runTool("mark", [part, vector], { ...OPTIONS, ...look }, workDir);
      tick();
      return outputPath;
    } catch (err) {
      const log = path.join(workDir, "error.log");
      fs.writeFileSync(log, String(err?.stack ?? err));
      throw new Error(`${path.basename(video)} with ${path.basename(vector)}, see ${log}`);
    }
  });

  // Each tile's parts joined back up, then laid out on the canvas.
  const inputs = tileDirs.flatMap((dir, t) => {
    const list = path.join(dir, "parts.txt");
    const parts = marked.slice(t * slots, (t + 1) * slots);
    fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join("\n"));
    return ["-f", "concat", "-safe", "0", "-i", list];
  });
  const layout = tiles.map(({ x, y }) => `${x}_${y}`).join("|");
  const stack =
    tiles.length > 1
      ? `${tiles.map((_, i) => `[${i}:v]`).join("")}xstack=inputs=${tiles.length}:layout=${layout}`
      : "[0:v]null";
  const output = path.join(outDir, `${name}.mp4`);
  await ff.runFFmpeg([
    "-y",
    ...inputs,
    "-filter_complex",
    `${stack},format=yuv420p[out]`,
    "-map",
    "[out]",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "12",
    "-movflags",
    "+faststart",
    output,
  ]);
  tick();
  return output;
}
