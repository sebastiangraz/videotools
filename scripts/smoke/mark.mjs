// Mark's grid: every clip in videos/ becomes one tile of a grid, cropped to a
// region up to ZOOM_OUT× the tile's size and scaled down into it. Every cycle,
// all tiles carry the same logo from vectors/, in order, each tile marked by
// its own Mark run. Lasts vectors × cycleDuration; clips loop to fill it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MARK_SIZES } from "../../api/_lib/tools/mark-graph.ts";

const cycleDuration = 2;
const ZOOM_OUT = 2;
const FPS = 30;
const MAX_CANVAS = { width: 1920, height: 1920 };

MARK_SIZES.smoke = { ...MARK_SIZES.dev, scale: 5 };
const OPTIONS = { filter: "glass", size: "smoke", position: "center", quality: 100 };
// Mark runs at once; each ffmpeg is multithreaded already.
const CONCURRENCY = Math.max(1, Math.floor(os.availableParallelism() / 4));

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

async function pool(items, limit, run) {
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

export async function markGrid({ ff, assets, outDir, runTool, say }) {
  const { videos, vectors } = assets;
  if (!videos.length || !vectors.length) throw new Error("needs videos/ and vectors/ assets");
  const infos = await Promise.all(videos.map((file) => ff.mediaInfo(file)));
  const smallest = {
    width: Math.min(...infos.map((i) => i.width)),
    height: Math.min(...infos.map((i) => i.height)),
  };
  const { width, height, tiles } = gridTiles(videos.length, smallest);
  const duration = vectors.length * cycleDuration;
  say(
    `mark: ${videos.length} videos × ${vectors.length} vectors → ${width}x${height} at up to ${ZOOM_OUT}× out, ${duration}s`,
  );

  // Each clip cropped to its tile, looped to length, cut into one part per
  // cycle (keyframes at the cuts, so the parts are frame-exact).
  const tileDirs = videos.map((_, i) => path.join(outDir, `tile${i}`));
  const cuts = vectors
    .slice(1)
    .map((_, v) => (v + 1) * cycleDuration)
    .join(",");
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
      ...(cuts ? ["-force_key_frames", cuts] : []),
      "-f",
      "segment",
      ...(cuts ? ["-segment_times", cuts] : []),
      "-reset_timestamps",
      "1",
      path.join(tileDirs[i], "part%d.mp4"),
    ]);
  });

  const runs = videos.flatMap((video, t) => vectors.map((vector, v) => ({ video, t, vector, v })));
  let done = 0;
  const marked = await pool(runs, CONCURRENCY, async ({ video, t, vector, v }) => {
    const part = path.join(tileDirs[t], `part${v}.mp4`);
    const workDir = path.join(tileDirs[t], String(v));
    try {
      const { outputPath } = await runTool("mark", [part, vector], OPTIONS, workDir);
      done += 1;
      if (done % vectors.length === 0) say(`  ${done}/${runs.length} marked`);
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
    const parts = marked.slice(t * vectors.length, (t + 1) * vectors.length);
    fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join("\n"));
    return ["-f", "concat", "-safe", "0", "-i", list];
  });
  const layout = tiles.map(({ x, y }) => `${x}_${y}`).join("|");
  const stack =
    tiles.length > 1
      ? `${tiles.map((_, i) => `[${i}:v]`).join("")}xstack=inputs=${tiles.length}:layout=${layout}`
      : "[0:v]null";
  const output = path.join(outDir, "mark.mp4");
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
  return output;
}
