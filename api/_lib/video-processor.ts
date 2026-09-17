import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

// Only `cwd` is ever passed through to spawn.
type RunOptions = { cwd?: string };

type RunResult = { code: number | null; stdout: string; stderr: string };

// What `ffmpeg -i` reports about an input. `fps` is null when no frame rate
// is printed; callers fall back to 30. `codec` is the decoder name ("h264",
// "png", "gif", ...).
type MediaInfo = {
  duration: number;
  width: number;
  height: number;
  fps: number | null;
  codec: string;
};

// Watermark layout and look, all relative to the video so the mark reads the
// same at every resolution. Position is fixed to the bottom-right corner.
const MARK = {
  // The logo is fitted (aspect kept) into a box this fraction of the video's
  // width and height.
  boxRatio: 0.12,
  // The gap to the frame edges is the logo's own size (see watermarkGraph):
  // a logotype's height, a tall mark's width, a square-ish one's mean of
  // both. Aspect ratios within this factor of 1:1 count as square-ish.
  squarish: 1.25,
  // How much of the fitting box the logo is actually drawn at. A square
  // mark fills its box both ways and reads heavier than an elongated one,
  // so it gets its own, smaller scale; its padding (from the already
  // reduced size) is eased back too.
  elongatedScale: 1.5,
  squarishScale: 0.75,
  squarishPadding: 0.75,
  // Ceiling on the padding, as a fraction of the frame's shorter side. The
  // shape rule takes the padding from the drawn logo, which for an asset
  // with a lot of empty canvas around the mark is far more than the mark
  // itself; this keeps such logos from drifting into the frame.
  maxPaddingRatio: 0.05,
  // Frosted-glass mode: the backdrop under the logo is blurred by this sigma
  // (fraction of the shorter side; the CSS analogue is backdrop-filter:
  // blur()), then saturated and mixed with white.
  blurRatio: 0.02,
  saturation: 1.35,
  tint: 0.22,
  // A stroke along the inside of the logo's edge (1px at 720p, scaling up),
  // like a light rim catching the light.
  rimOpacity: 0.55,
  // Soft drop shadow behind the glass shape, offset downwards.
  shadowBlurRatio: 0.012,
  shadowOffsetRatio: 0.006,
  shadowOpacity: 0.35,
  // The logo's own pixels over the glass: a white logo brightens it, a dark
  // one smokes it, a coloured one tints it.
  logoOpacity: 0.45,
};

/**
 * Cross-platform video tools: seamless loops (reverse / crossfade), sequence
 * assembly (mp4 / gif / avif), format conversion and watermarking, all
 * pure-Node ffmpeg — except video→GIF, which pipes ffmpeg-extracted frames
 * through the vendored gifski binary for pngquant palettes and temporal
 * dithering.
 */
class VideoProcessor {
  ffmpeg: string;
  gifski: string;
  signal: AbortSignal | null;
  gifskiChmodDone = false;
  // Inputs are immutable for the life of a job, so probe each file once.
  private infoCache = new Map<string, MediaInfo>();

  // `signal` (optional AbortSignal) cancels the pipeline: the running child
  // process is killed and every later command rejects right away.
  constructor(
    ffmpegPath: string,
    gifskiPath: string,
    signal: AbortSignal | null = null,
  ) {
    this.ffmpeg = ffmpegPath;
    this.gifski = gifskiPath;
    this.signal = signal;
  }

  // x264 crf: 0 best – 51 worst; quality 100 → 1 (visually lossless — true
  // lossless x264 forces the High 4:4:4 profile most players reject),
  // quality 1 → 35.
  static x264Crf(quality: number): string {
    return String(Math.max(1, Math.round(35 - (quality / 100) * 34)));
  }

  async createLoop(
    inputFile: string,
    technique = "reverse",
    fadeDuration = "0.5",
    startSecond = "0",
    quality = 100,
  ): Promise<string> {
    const outputFile = `${inputFile}_loop.mp4`;

    console.log(`Processing video: ${inputFile}`);
    console.log(`Output will be saved to: ${outputFile}`);
    console.log(`Using technique: ${technique}`);

    try {
      // Check if input file exists
      await fs.access(inputFile);

      const crf = VideoProcessor.x264Crf(quality);

      if (technique === "crossfade") {
        await this.createCrossfadeLoop(
          inputFile,
          outputFile,
          fadeDuration,
          startSecond,
          crf,
        );
      } else {
        // Default to reverse technique
        await this.createReverseLoop(inputFile, outputFile, crf);
      }

      // Verify output file was created
      await fs.access(outputFile);
      console.log(`Success! Seamless loop created at: ${outputFile}`);

      return outputFile;
    } catch (error) {
      console.error("Processing error:", error);
      throw error;
    }
  }

  async createReverseLoop(
    inputFile: string,
    outputFile: string,
    crf = "18",
  ): Promise<void> {
    console.log("Creating simple reversed loop...");

    const tempDir = path.join(
      path.dirname(inputFile),
      `tmp_loop_${Date.now()}`,
    );
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const reverseFile = path.join(tempDir, "reverse.mp4");

      // Create reversed video. The reversed half gets encoded again in the
      // concat below, so keep this intermediate near-lossless to avoid
      // generation loss.
      await this.runFFmpeg([
        "-y",
        "-i",
        inputFile,
        "-vf",
        "reverse",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "6",
        reverseFile,
      ]);

      // Concatenate original and reversed
      await this.runFFmpeg([
        "-y",
        "-i",
        inputFile,
        "-i",
        reverseFile,
        "-filter_complex",
        // Normalize SAR on both inputs: re-encoding can round a source's
        // pixel aspect ratio differently, and concat rejects mismatched SARs.
        "[0:v]setsar=1[v0];[1:v]setsar=1[v1];[v0][v1]concat=n=2:v=1:a=0",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        crf,
        "-pix_fmt",
        "yuv420p",
        outputFile,
      ]);
    } finally {
      // Clean up temp directory
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async createCrossfadeLoop(
    inputFile: string,
    outputFile: string,
    fadeDuration: string,
    startSecond: string,
    crf = "18",
  ): Promise<void> {
    console.log("Creating seamless loop with crossfade technique...");
    console.log(`Using fade duration: ${fadeDuration} seconds`);
    console.log(`Starting from: ${startSecond} seconds`);

    // Get video info
    const duration = await this.getVideoDuration(inputFile);
    const fps = await this.getVideoFPS(inputFile);

    console.log(`Video duration: ${duration} seconds, FPS: ${fps}`);

    // Validate fade duration
    if (parseFloat(fadeDuration) >= duration / 2) {
      throw new Error(
        `Fade duration (${fadeDuration}) must be less than half the video duration (${
          duration / 2
        })`,
      );
    }

    if (parseFloat(fadeDuration) === 0) {
      // No fade, just copy or reorder
      if (parseFloat(startSecond) === 0) {
        console.log("No fade, no reorder: copying original file");
        await fs.copyFile(inputFile, outputFile);
      } else {
        console.log("No fade, reordering segments...");
        await this.reorderSegments(
          inputFile,
          outputFile,
          startSecond,
          duration,
          crf,
        );
      }
      return;
    }

    // Create crossfade loop
    const tempDir = path.join(
      path.dirname(inputFile),
      `tmp_loop_${Date.now()}`,
    );
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const startClip = path.join(tempDir, "start.mp4");
      const endClip = path.join(tempDir, "end.mp4");
      const crossfadeClip = path.join(tempDir, "crossfade.mp4");

      // Extract start and end segments. These are re-encoded again by the
      // xfade step, so keep them near-lossless to avoid generation loss.
      const endStartTime = duration - parseFloat(fadeDuration);

      await this.runFFmpeg([
        "-y",
        "-i",
        inputFile,
        "-t",
        fadeDuration,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "6",
        "-r",
        fps.toString(),
        "-pix_fmt",
        "yuv420p",
        startClip,
      ]);

      await this.runFFmpeg([
        "-y",
        "-i",
        inputFile,
        "-ss",
        endStartTime.toString(),
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "6",
        "-r",
        fps.toString(),
        "-pix_fmt",
        "yuv420p",
        endClip,
      ]);

      // Create crossfade. This clip (and the segments below) land in the
      // output unchanged via stream-copy concat, so they use the user crf.
      await this.runFFmpeg([
        "-y",
        "-i",
        endClip,
        "-i",
        startClip,
        "-filter_complex",
        `[0:v][1:v]xfade=transition=fade:duration=${fadeDuration}:offset=0[out]`,
        "-map",
        "[out]",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        crf,
        "-r",
        fps.toString(),
        "-pix_fmt",
        "yuv420p",
        crossfadeClip,
      ]);

      // Create final video based on start second
      if (parseFloat(startSecond) === 0) {
        // Standard loop: main body + crossfade
        const mainClip = path.join(tempDir, "main.mp4");
        const mainStart = parseFloat(fadeDuration);
        const mainDuration = duration - 2 * parseFloat(fadeDuration);

        await this.runFFmpeg([
          "-y",
          "-i",
          inputFile,
          "-ss",
          mainStart.toString(),
          "-t",
          mainDuration.toString(),
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          crf,
          "-r",
          fps.toString(),
          "-pix_fmt",
          "yuv420p",
          mainClip,
        ]);

        await this.concatenateVideos(
          [mainClip, crossfadeClip],
          outputFile,
          tempDir,
          crf,
        );
      } else {
        // Custom start: segment after start + crossfade + segment before start
        const seg1 = path.join(tempDir, "seg1.mp4");
        const seg3 = path.join(tempDir, "seg3.mp4");

        const seg1Duration = endStartTime - parseFloat(startSecond);
        const seg3Duration = parseFloat(startSecond) - parseFloat(fadeDuration);

        const segments: string[] = [];

        if (seg1Duration > 0) {
          await this.runFFmpeg([
            "-y",
            "-i",
            inputFile,
            "-ss",
            startSecond,
            "-t",
            seg1Duration.toString(),
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            crf,
            "-r",
            fps.toString(),
            "-pix_fmt",
            "yuv420p",
            seg1,
          ]);
          segments.push(seg1);
        }

        segments.push(crossfadeClip);

        if (seg3Duration > 0) {
          await this.runFFmpeg([
            "-y",
            "-i",
            inputFile,
            "-ss",
            fadeDuration,
            "-t",
            seg3Duration.toString(),
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            crf,
            "-r",
            fps.toString(),
            "-pix_fmt",
            "yuv420p",
            seg3,
          ]);
          segments.push(seg3);
        }

        await this.concatenateVideos(segments, outputFile, tempDir, crf);
      }
    } finally {
      // Clean up temp directory
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async createImageSequenceVideo(
    imagePaths: string[],
    workDir: string,
    frameDuration: number,
    format: string,
    quality = 100,
  ): Promise<string> {
    console.log(
      `Assembling ${imagePaths.length} images into ${format} (quality ${quality})...`,
    );

    const outputFile = path.join(workDir, `output.${format}`);

    // Target frame size: first image's dimensions, capped at 1920 on the
    // longest side (bounds gif/avif encode cost), floored to even for
    // yuv420p/x264.
    const { width: w, height: h } = await this.mediaInfo(imagePaths[0]);
    const scaleFactor = Math.min(1, 1920 / Math.max(w, h));
    const W = Math.max(2, Math.floor((w * scaleFactor) / 2) * 2);
    const H = Math.max(2, Math.floor((h * scaleFactor) / 2) * 2);

    // Normalize every image to a uniform PNG frame (mixed formats and
    // dimensions are the norm for user uploads; the sequence demuxer
    // needs identical frames).
    const framesDir = path.join(workDir, "frames");
    await fs.mkdir(framesDir, { recursive: true });
    for (let i = 0; i < imagePaths.length; i++) {
      const framePath = path.join(
        framesDir,
        `norm_${String(i + 1).padStart(4, "0")}.png`,
      );
      await this.runFFmpeg([
        "-y",
        "-i",
        imagePaths[i],
        "-vf",
        `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`,
        "-frames:v",
        "1",
        framePath,
      ]);
    }

    const framerate = (1 / frameDuration).toString();
    const pattern = path.join(framesDir, "norm_%04d.png");

    if (format === "gif") {
      // Quality drives the palette size; at high quality use a fresh
      // palette per frame (much better color, larger file).
      const colors = Math.max(
        16,
        Math.min(256, Math.round((quality / 100) * 256)),
      );
      const perFrame = quality >= 80;
      const vf = perFrame
        ? `split[a][b];[a]palettegen=stats_mode=single:max_colors=${colors}[p];[b][p]paletteuse=new=1:dither=sierra2_4a`
        : `split[a][b];[a]palettegen=stats_mode=diff:max_colors=${colors}[p];[b][p]paletteuse=dither=sierra2_4a`;
      await this.runFFmpeg([
        "-y",
        "-framerate",
        framerate,
        "-i",
        pattern,
        "-vf",
        vf,
        "-loop",
        "0",
        outputFile,
      ]);
    } else if (format === "avif") {
      if (quality >= 100) {
        // Truly lossless: planar RGB (gbrp) skips the RGB→YUV rounding and
        // chroma subsampling, and aom's lossless mode skips quantization.
        // Verified bit-exact against the source frames (PSNR = inf).
        await this.runFFmpeg([
          "-y",
          "-framerate",
          framerate,
          "-i",
          pattern,
          "-c:v",
          "libaom-av1",
          "-crf",
          "0",
          "-b:v",
          "0",
          "-aom-params",
          "lossless=1",
          "-cpu-used",
          "6",
          "-row-mt",
          "1",
          "-threads",
          "0",
          "-pix_fmt",
          "gbrp",
          "-f",
          "avif",
          outputFile,
        ]);
      } else {
        // libaom crf: 0 best – 63 worst; quality 99 → 1, quality 1 → 62.
        // Slow the encoder down a notch and keep full chroma resolution at
        // high quality (yuv420p halves color detail regardless of crf).
        const crf = Math.round(63 * (1 - quality / 100));
        const cpuUsed = quality >= 80 ? "6" : "8";
        const pixFmt = quality >= 90 ? "yuv444p" : "yuv420p";
        await this.runFFmpeg([
          "-y",
          "-framerate",
          framerate,
          "-i",
          pattern,
          "-c:v",
          "libaom-av1",
          "-crf",
          String(crf),
          "-b:v",
          "0",
          "-cpu-used",
          cpuUsed,
          "-row-mt",
          "1",
          "-threads",
          "0",
          "-pix_fmt",
          pixFmt,
          "-f",
          "avif",
          outputFile,
        ]);
      }
    } else {
      // mp4: constant 30fps output (frames duplicated by the fps filter)
      // so every player handles very low source frame rates.
      const crf = VideoProcessor.x264Crf(quality);
      await this.runFFmpeg([
        "-y",
        "-framerate",
        framerate,
        "-i",
        pattern,
        "-vf",
        "fps=30,format=yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        crf,
        "-movflags",
        "+faststart",
        outputFile,
      ]);
    }

    return outputFile;
  }

  // Frame budget for video→GIF: PNG frames land on the function's ~500MB
  // ephemeral disk, and at ≤800px they average well under 1MB each.
  static get MAX_GIF_FRAMES(): number {
    return 600;
  }

  // libaom is slow enough that long clips would blow the 300s function
  // timeout, so animated AVIF gets a duration ceiling.
  static get MAX_AVIF_SECONDS(): number {
    return 60;
  }

  async convertVideo(
    inputFile: string,
    workDir: string,
    target: string,
    quality = 90,
  ): Promise<string> {
    console.log(`Converting to ${target} (quality ${quality})...`);

    const outputFile = path.join(workDir, `output.${target}`);
    // yuv420p needs even dimensions and odd-sized sources exist.
    const evenScale = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

    if (target === "webm") {
      // VP9 crf: 0 best – 63 worst; quality 100 → 10, quality 1 → 50.
      const crf = String(Math.round(50 - (quality / 100) * 40));
      await this.runFFmpeg([
        "-y",
        "-i",
        inputFile,
        "-vf",
        evenScale,
        "-c:v",
        "libvpx-vp9",
        "-crf",
        crf,
        "-b:v",
        "0",
        "-row-mt",
        "1",
        "-cpu-used",
        "4",
        "-deadline",
        "good",
        "-pix_fmt",
        "yuv420p",
        // Opus rejects some surround layouts, so downmix to stereo.
        "-c:a",
        "libopus",
        "-b:a",
        "128k",
        "-ac",
        "2",
        outputFile,
      ]);
    } else if (target === "webp") {
      // Animated WebP is intra-only (every frame is a standalone lossy
      // still), so output often exceeds the source video's size — inherent
      // to the format, not the settings. Don't be tempted by cr_threshold:
      // its block skipping leaves stale gray squares in flat/dark/bright
      // regions, for a measured saving of only a few percent.
      //
      const fps = Math.min(await this.getVideoFPS(inputFile), 30);
      const webpScale = `fps=${fps},scale='min(800,iw)':-2:flags=lanczos`;
      if (quality >= 100) {
        // True lossless (relative to the decoded RGB frames): no VP8
        // quantization at all, so none of its block-grid artifacts on
        // solid colors. -q:v in lossless mode means compression effort,
        // not fidelity. Expect large files.
        await this.runFFmpeg([
          "-y",
          "-i",
          inputFile,
          "-vf",
          webpScale,
          "-c:v",
          "libwebp_anim",
          "-lossless",
          "1",
          "-q:v",
          "75",
          "-pix_fmt",
          "bgra",
          "-loop",
          "0",
          "-an",
          outputFile,
        ]);
      } else {
        // The slider maps to 65–100 rather than libwebp's raw scale: below
        // ~83 VP8 quantizes fine texture down to per-block averages, which
        // reads as a block grid on solid colors (x264 at the same slider
        // position preserves texture, so the formats would look wildly
        // different at "equal" quality).
        const webpQuality = Math.round(65 + (quality / 100) * 35);
        await this.runFFmpeg([
          "-y",
          "-i",
          inputFile,
          "-vf",
          webpScale,
          "-c:v",
          "libwebp_anim",
          "-q:v",
          String(webpQuality),
          // "icon" despite the name: it disables spatial noise shaping,
          // which otherwise starves flat/solid regions of bits and leaves a
          // faint block grid there. Measured better PSNR than the default
          // on both flat and detailed content (~12% larger on detail-heavy
          // frames).
          "-preset",
          "icon",
          "-loop",
          "0",
          "-an",
          outputFile,
        ]);
      }
    } else if (target === "avif") {
      const duration = await this.getVideoDuration(inputFile);
      if (duration > VideoProcessor.MAX_AVIF_SECONDS) {
        throw new Error(
          `Video too long for AVIF: ${Math.round(duration)}s exceeds the ` +
            `${VideoProcessor.MAX_AVIF_SECONDS}s limit (AVIF encoding is ` +
            `slow). Trim the video or pick another format.`,
        );
      }
      // AV1 crf mapped like the webm branch: quality 100 → 10, quality 1 →
      // 50. (The sequence tool's 63·(1−q) curve reaches crf 0 at quality
      // 100 — near-lossless, which balloons video conversions.) Width caps
      // at 800 like the other animated-image targets; the trunc keeps odd
      // sub-800 sources even for yuv420p.
      const crf = Math.round(50 - (quality / 100) * 40);
      const fps = Math.min(await this.getVideoFPS(inputFile), 30);
      await this.runFFmpeg([
        "-y",
        "-i",
        inputFile,
        "-vf",
        `fps=${fps},scale='trunc(min(800,iw)/2)*2':-2:flags=lanczos`,
        "-c:v",
        "libaom-av1",
        "-crf",
        String(crf),
        "-b:v",
        "0",
        "-cpu-used",
        "8",
        "-row-mt",
        "1",
        "-threads",
        "0",
        "-pix_fmt",
        "yuv420p",
        "-an",
        "-f",
        "avif",
        outputFile,
      ]);
    } else {
      // mp4 / mov: H.264 + AAC.
      const crf = VideoProcessor.x264Crf(quality);
      const args = [
        "-y",
        "-i",
        inputFile,
        "-vf",
        evenScale,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        crf,
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
      ];
      if (target === "mp4") {
        args.push("-movflags", "+faststart");
      }
      args.push(outputFile);
      await this.runFFmpeg(args);
    }

    return outputFile;
  }

  async videoToGif(
    inputFile: string,
    workDir: string,
    quality = 90,
    fps: number | null = null,
    width = 640,
  ): Promise<string> {
    // No explicit fps → match the source, capped at GIF's practical ceiling
    // (delays are centiseconds; browsers clamp anything ≥50fps).
    if (fps == null) {
      fps = Math.max(
        1,
        Math.min(Math.round(await this.getVideoFPS(inputFile)), 30),
      );
    }
    console.log(
      `Converting to GIF via gifski (quality ${quality}, ${fps} fps, ${width}px)...`,
    );

    const duration = await this.getVideoDuration(inputFile);
    const maxFrames = VideoProcessor.MAX_GIF_FRAMES;
    if (duration * fps > maxFrames) {
      throw new Error(
        `Video too long for GIF: ${Math.round(duration)}s at ${fps} fps ` +
          `exceeds ${maxFrames} frames. Lower the FPS or trim the video to ` +
          `${Math.floor(maxFrames / fps)}s or less.`,
      );
    }

    const framesDir = path.join(workDir, "gif_frames");
    await fs.mkdir(framesDir, { recursive: true });

    try {
      await this.runFFmpeg([
        "-y",
        "-i",
        inputFile,
        "-vf",
        `fps=${fps},scale='min(${width},iw)':-2:flags=lanczos`,
        path.join(framesDir, "frame_%05d.png"),
      ]);

      const frames = (await fs.readdir(framesDir))
        .filter((f) => f.endsWith(".png"))
        .sort()
        .map((f) => path.join(framesDir, f));
      if (!frames.length) {
        throw new Error("No frames extracted from video");
      }

      const outputFile = path.join(workDir, "output.gif");
      // spawn uses no shell, so the frame list is passed as explicit args
      // (600 paths ≈ 40KB, far under the platform arg limit).
      await this.runGifski([
        "--fps",
        String(fps),
        "--quality",
        String(quality),
        "-o",
        outputFile,
        ...frames,
      ]);
      return outputFile;
    } finally {
      await fs.rm(framesDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Stamps `logoFile` (png / jpg / gif / webp) onto the bottom-right corner
   * of `inputFile`. With `filter` the logo's alpha becomes the shape of a
   * frosted-glass panel (see MARK) instead of a plain overlay. Animated GIFs
   * loop for the length of the video. Audio is kept. Output is mp4.
   */
  async addWatermark(
    inputFile: string,
    logoFile: string,
    workDir: string,
    filter = false,
    quality = 90,
  ): Promise<string> {
    console.log(
      `Adding watermark (${filter ? "glass" : "plain"}, quality ${quality})...`,
    );

    const video = await this.mediaInfo(inputFile);
    const logo = await this.mediaInfo(logoFile);
    const { graph, animated } = VideoProcessor.watermarkGraph(
      video,
      logo,
      filter,
    );

    const outputFile = path.join(workDir, "output.mp4");
    await this.runFFmpeg([
      "-y",
      "-i",
      inputFile,
      // A still image is a one-frame stream, which overlay simply holds for
      // the whole video. A GIF plays through once and would freeze on its
      // last frame, so it is looped at the demuxer instead (regardless of
      // the file's own loop count) and the graph ends with the video.
      ...(animated ? ["-stream_loop", "-1"] : []),
      "-i",
      logoFile,
      "-filter_complex",
      graph,
      "-map",
      "[out]",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      VideoProcessor.x264Crf(quality),
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      outputFile,
    ]);

    return outputFile;
  }

  /**
   * One composited frame for the UI's preview: `frameFile` is a still (the
   * browser's grab of the video's first frame) and goes through exactly the
   * graph addWatermark uses, so whatever the filter does, the preview shows.
   * Returns a JPEG.
   */
  async renderWatermarkFrame(
    frameFile: string,
    logoFile: string,
    workDir: string,
    filter = false,
  ): Promise<string> {
    const frame = await this.mediaInfo(frameFile);
    const logo = await this.mediaInfo(logoFile);
    const { graph, animated } = VideoProcessor.watermarkGraph(
      frame,
      logo,
      filter,
    );

    const outputFile = path.join(workDir, "preview.jpg");
    await this.runFFmpeg([
      "-y",
      "-i",
      frameFile,
      // A GIF logo shows its first frame; the loop just keeps the graph's
      // sync options identical to the real encode.
      ...(animated ? ["-stream_loop", "-1"] : []),
      "-i",
      logoFile,
      "-filter_complex",
      graph,
      "-map",
      "[out]",
      "-frames:v",
      "1",
      "-q:v",
      "3",
      outputFile,
    ]);

    return outputFile;
  }

  // Builds the watermark filtergraph (inputs: [0] video, [1] logo; output
  // [out]). Every dimension is computed here from the probed sizes rather
  // than with filter expressions, so the glass pipeline can crop just the
  // patch of video under the logo instead of blurring whole frames.
  static watermarkGraph(
    video: MediaInfo,
    logo: MediaInfo,
    filter: boolean,
  ): { graph: string; animated: boolean } {
    // Frame size floored to even for yuv420p (odd-sized sources exist), and
    // every patch size/offset kept even too: crop on a subsampled source
    // rounds them otherwise, and the patches must line up exactly.
    const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
    const VW = even(video.width);
    const VH = even(video.height);
    const shorter = Math.min(VW, VH);

    const aspect = logo.width / logo.height;
    const squarish = aspect <= MARK.squarish && aspect >= 1 / MARK.squarish;
    // Fitted into the box, then drawn at the shape's own scale of it.
    const fit =
      Math.min(
        (VW * MARK.boxRatio) / logo.width,
        (VH * MARK.boxRatio) / logo.height,
      ) * (squarish ? MARK.squarishScale : MARK.elongatedScale);
    const LW = even(Math.round(logo.width * fit));
    const LH = even(Math.round(logo.height * fit));
    // Padding between the logo and the corner, taken from the logo itself
    // so the mark always sits one "logo" in from the edges: a logotype
    // (wider than tall) uses its height, a tall mark its width, and a
    // square-ish one the mean of the two, eased back a little.
    const margin = Math.min(
      squarish
        ? Math.round(((LW + LH) / 2) * MARK.squarishPadding)
        : aspect > 1
          ? LH
          : LW,
      Math.round(shorter * MARK.maxPaddingRatio),
    );
    // The logo's top-left corner in the frame.
    const LX = VW - margin - LW;
    const LY = VH - margin - LH;

    const animated = logo.codec === "gif";
    // Looping the GIF makes it an endless stream, so every filter that syncs
    // a video-derived stream with a logo-derived one must stop with the video.
    const shortest = animated ? ":shortest=1" : "";
    const stop = animated ? "=shortest=1" : "";

    // The base is pinned to limited-range yuv420p before anything else:
    // full-range sources (JPEG stills from the preview's frame grab, some
    // phone footage) would otherwise reach the final overlay through a
    // different conversion than the glass patch and leave a faint box.
    if (!filter) {
      const graph = [
        `[0:v]format=yuv420p,crop=${VW}:${VH}:0:0[base]`,
        `[1:v]format=rgba,scale=${LW}:${LH}:flags=lanczos[logo]`,
        `[base][logo]overlay=x=${LX}:y=${LY}${shortest},format=yuv420p[out]`,
      ].join(";");
      return { graph, animated };
    }

    // The glass is built on a "cell": the logo box plus `margin` of padding
    // on every side, so shadow and blur have room to spill. The cell reaches
    // the frame edge exactly, never past it.
    const P = margin;
    const CW = LW + 2 * P;
    const CH = LH + 2 * P;
    const CX = LX - P;
    const CY = LY - P;

    const sigma = (shorter * MARK.blurRatio).toFixed(2);
    const shadowSigma = (shorter * MARK.shadowBlurRatio).toFixed(2);
    const shadowDy = Math.max(1, Math.round(shorter * MARK.shadowOffsetRatio));
    // Rim width in px: each erosion pass eats one pixel off the mask.
    const rimPx = Math.max(1, Math.round(shorter / 720));

    // Saturation as an RGB matrix (colorchannelmixer has no offset term, so
    // the white tint is a separate lut): c' = (1-s)·luma + s·c.
    const lum: Record<string, number> = { r: 0.299, g: 0.587, b: 0.114 };
    const s = MARK.saturation;
    const saturate = ["r", "g", "b"]
      .flatMap((o) =>
        ["r", "g", "b"].map(
          (i) =>
            `${o}${i}=${((1 - s) * lum[i] + (o === i ? s : 0)).toFixed(4)}`,
        ),
      )
      .join(":");
    const t = MARK.tint;
    const tint = ["r", "g", "b"]
      .map((c) => `${c}='val*${(1 - t).toFixed(3)}+${(255 * t).toFixed(1)}'`)
      .join(":");

    const graph = [
      `[0:v]format=yuv420p,crop=${VW}:${VH}:0:0,split[base][src]`,
      // The patch of video under the cell, twice: one to blur, one to build on.
      `[src]crop=${CW}:${CH}:${CX}:${CY},format=rgba,split[cellA][cellB]`,
      // The logo scaled and centred in a transparent cell-sized canvas.
      `[1:v]format=rgba,scale=${LW}:${LH}:flags=lanczos,pad=${CW}:${CH}:${P}:${P}:color=black@0,split[lg1][lg2]`,
      `[lg1]alphaextract,split=4[m1][m2][m3][m4]`,
      // Frosted fill: blur, saturate, lighten; shaped by the logo's alpha.
      `[cellA]gblur=sigma=${sigma}:steps=2,colorchannelmixer=${saturate},lutrgb=${tint}[blurred]`,
      `[blurred][m1]alphamerge${stop}[glass]`,
      // Rim: the mask minus itself eroded by a pixel or so, painted white.
      `[m2]${Array<string>(rimPx).fill("erosion").join(",")}[eroded]`,
      `[m3][eroded]blend=all_mode=subtract,split[rk1][rk2]`,
      `[rk1]format=rgba,lutrgb=r=255:g=255:b=255[white]`,
      `[white][rk2]alphamerge,colorchannelmixer=aa=${MARK.rimOpacity}[rim]`,
      // Shadow: the mask blurred, painted black, offset downwards on overlay.
      `[m4]gblur=sigma=${shadowSigma}:steps=2,split[sk1][sk2]`,
      `[sk1]format=rgba,lutrgb=r=0:g=0:b=0[black]`,
      `[black][sk2]alphamerge,colorchannelmixer=aa=${MARK.shadowOpacity}[shadow]`,
      `[lg2]colorchannelmixer=aa=${MARK.logoOpacity}[faint]`,
      // Stack the layers on the untouched patch, then put it back.
      `[cellB][shadow]overlay=x=0:y=${shadowDy}:format=auto${shortest}[c1]`,
      `[c1][glass]overlay=format=auto${shortest}[c2]`,
      `[c2][rim]overlay=format=auto${shortest}[c3]`,
      `[c3][faint]overlay=format=auto${shortest}[cell]`,
      `[base][cell]overlay=x=${CX}:y=${CY}${shortest},format=yuv420p[out]`,
    ].join(";");
    return { graph, animated };
  }

  async changeSpeed(inputFile: string, multiplier: number): Promise<string> {
    console.log(`Changing playback speed by ${multiplier}x...`);

    const outputFile = `${inputFile}_speed.mp4`;
    const fps = await this.getVideoFPS(inputFile);

    // setpts rescales frame timestamps; keeping the source frame rate via
    // -r makes speed-ups drop frames (instead of raising the output fps)
    // and slow-downs duplicate frames. Audio is dropped like in the other
    // tools.
    await this.runFFmpeg([
      "-y",
      "-i",
      inputFile,
      "-vf",
      `setpts=PTS/${multiplier}`,
      "-r",
      fps.toString(),
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "22",
      "-pix_fmt",
      "yuv420p",
      outputFile,
    ]);

    return outputFile;
  }

  async reorderSegments(
    inputFile: string,
    outputFile: string,
    startSecond: string,
    duration: number,
    crf = "18",
  ): Promise<void> {
    const tempDir = path.join(
      path.dirname(inputFile),
      `tmp_loop_${Date.now()}`,
    );
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const afterPart = path.join(tempDir, "after.mp4");
      const beforePart = path.join(tempDir, "before.mp4");

      // Extract segment after start second
      await this.runFFmpeg([
        "-y",
        "-i",
        inputFile,
        "-ss",
        startSecond,
        "-c",
        "copy",
        afterPart,
      ]);

      // Extract segment before start second
      await this.runFFmpeg([
        "-y",
        "-i",
        inputFile,
        "-to",
        startSecond,
        "-c",
        "copy",
        beforePart,
      ]);

      await this.concatenateVideos(
        [afterPart, beforePart],
        outputFile,
        tempDir,
        crf,
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async concatenateVideos(
    videoFiles: string[],
    outputFile: string,
    tempDir: string,
    crf = "18",
  ): Promise<void> {
    const listFile = path.join(tempDir, "concat_list.txt");
    const listContent = videoFiles
      .map((f) => `file '${path.basename(f)}'`)
      .join("\n");

    await fs.writeFile(listFile, listContent);

    console.log(`Created concat list at: ${listFile}`);
    console.log(`List content:\n${listContent}`);

    // Try fast copy first, fallback to re-encoding
    try {
      await this.runFFmpeg(
        [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          path.basename(listFile), // Use relative path within temp directory
          "-c",
          "copy",
          path.resolve(outputFile), // Use absolute path for output
        ],
        { cwd: tempDir },
      );
    } catch {
      console.log("Fast concatenation failed, trying with re-encoding...");
      await this.runFFmpeg(
        [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          path.basename(listFile), // Use relative path within temp directory
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          crf,
          "-pix_fmt",
          "yuv420p",
          path.resolve(outputFile), // Use absolute path for output
        ],
        { cwd: tempDir },
      );
    }
  }

  async getVideoDuration(inputFile: string): Promise<number> {
    return (await this.mediaInfo(inputFile)).duration;
  }

  async getVideoFPS(inputFile: string): Promise<number> {
    return (await this.mediaInfo(inputFile)).fps ?? 30;
  }

  // ffmpeg itself reports everything the tools need to know about an input,
  // so there is no separate ffprobe binary to ship. `ffmpeg -i` with no
  // output prints the stream summary to stderr and exits non-zero, which is
  // the expected outcome here rather than a failure.
  async mediaInfo(inputFile: string): Promise<MediaInfo> {
    const cached = this.infoCache.get(inputFile);
    if (cached) return cached;
    const { stderr } = await this.run(this.ffmpeg, [
      "-hide_banner",
      "-i",
      inputFile,
    ]);
    const info = VideoProcessor.parseMediaInfo(stderr);
    if (!info) {
      throw new Error(`Could not read media info: ${stderr.trim()}`);
    }
    this.infoCache.set(inputFile, info);
    return info;
  }

  // Parses the `-i` summary, e.g.
  //   Duration: 00:00:03.00, start: 0.000000, bitrate: 46 kb/s
  //   Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661),
  //     yuv420p(progressive), 320x240 [SAR 1:1 DAR 4:3], 40 kb/s, 29.97 fps,
  //     29.97 tbr, 11988 tbn (default)
  // The video line is split on ", " so a WxH field is matched whole: the
  // codec tag (`0x31637661`) never starts a field. Stills report
  // "Duration: N/A", which reads as 0.
  static parseMediaInfo(summary: string): MediaInfo | null {
    const video = summary
      .split("\n")
      .find((line) => /Stream #\d+:\d+.*: Video: /.test(line));
    if (!video) return null;
    const fields = video.slice(video.indexOf(": Video: ")).split(", ");
    const size = fields.map((f) => /^(\d+)x(\d+)\b/.exec(f)).find(Boolean);
    if (!size) return null;
    const codec = /: Video: (\w+)/.exec(video)?.[1] ?? "";

    const rate =
      fields.map((f) => /^([\d.]+) fps\b/.exec(f)).find(Boolean) ??
      fields.map((f) => /^([\d.]+) tbr\b/.exec(f)).find(Boolean);
    const fps = rate ? parseFloat(rate[1]) : NaN;

    const dur = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(summary);
    const duration = dur
      ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3])
      : 0;

    return {
      duration,
      width: Number(size[1]),
      height: Number(size[2]),
      fps: Number.isFinite(fps) && fps > 0 ? fps : null,
      codec,
    };
  }

  runFFmpeg(args: string[], options: RunOptions = {}): Promise<string> {
    return this.runCommand(this.ffmpeg, args, options);
  }

  async runGifski(args: string[], options: RunOptions = {}): Promise<string> {
    if (!this.gifski) {
      throw new Error("gifski binary path not configured");
    }
    // The vendored binary's exec bit may not survive a Windows checkout or
    // the deploy bundling, so restore it before the first spawn.
    if (process.platform !== "win32" && !this.gifskiChmodDone) {
      await fs.chmod(this.gifski, 0o755).catch(() => {});
      this.gifskiChmodDone = true;
    }
    return this.runCommand(this.gifski, args, options);
  }

  // Resolves with the child's stdout; a non-zero exit is an error.
  async runCommand(
    command: string,
    args: string[],
    options: RunOptions = {},
  ): Promise<string> {
    const { code, stdout, stderr } = await this.run(command, args, options);
    if (code === 0) return stdout;
    console.error(`Command failed with code ${code}`);
    console.error(`Command: ${command} ${args.join(" ")}`);
    if (options.cwd) {
      console.error(`Working directory: ${options.cwd}`);
    }
    console.error(`stderr: ${stderr}`);
    throw new Error(`Command failed: ${stderr || `Exit code ${code}`}`);
  }

  // Runs the child to completion and reports its exit code and output;
  // rejects only when it could not be started or was cancelled.
  run(
    command: string,
    args: string[],
    options: RunOptions = {},
  ): Promise<RunResult> {
    return new Promise<RunResult>((resolve, reject) => {
      console.log(`Running: ${command} ${args.join(" ")}`);
      if (options.cwd) {
        console.log(`Working directory: ${options.cwd}`);
      }

      // Node kills the child (SIGKILL: the partial output is discarded
      // anyway) when the signal fires, and emits 'error' if it already had.
      const signal = this.signal ?? undefined;
      const process = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        signal,
        killSignal: "SIGKILL",
        ...options,
      });

      let stdout = "";
      let stderr = "";

      process.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      process.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      process.on("close", (code) => {
        if (signal?.aborted) {
          reject(new Error("Cancelled"));
        } else {
          resolve({ code, stdout, stderr });
        }
      });

      process.on("error", (error) => {
        if (signal?.aborted) {
          reject(new Error("Cancelled"));
          return;
        }
        console.error(`Failed to start command: ${command} ${args.join(" ")}`);
        console.error(`Error: ${error.message}`);
        reject(new Error(`Failed to start command: ${error.message}`));
      });
    });
  }
}

export default VideoProcessor;
