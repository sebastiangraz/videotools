import fs from "node:fs/promises";
import path from "node:path";

export const fileSize = async (file: string): Promise<number> => (await fs.stat(file)).size;

// Best effort: a leftover only takes up temp space.
export const removeDir = (dir: string): Promise<void> =>
  fs.rm(dir, { recursive: true, force: true }).catch(() => {});

// Cosmetic only: ffmpeg sniffs the container from content.
export function fileExt(name: string, fallback: string): string {
  const ext = path.extname(name);
  return /^\.\w+$/.test(ext) ? ext : fallback;
}

export function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

export function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export const clampInt = (value: unknown, min: number, max: number, fallback: number): number =>
  Math.round(clamp(value, min, max, fallback));

// Down to even, 2 at least: yuv420p halves both sides.
export const floorEven = (n: number): number => Math.max(2, Math.floor(n / 2) * 2);

// For messages: "1280×720".
export const sizeLabel = (width: number, height: number): string =>
  `${Math.round(width)}×${Math.round(height)}`;

// Unit vector `deg` degrees clockwise from the top, y down.
export const towards = (deg: number): [number, number] => {
  const angle = (deg * Math.PI) / 180;
  return [Math.sin(angle), -Math.cos(angle)];
};
