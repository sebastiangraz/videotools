import fs from "node:fs/promises";

export const fileSize = async (file: string): Promise<number> => (await fs.stat(file)).size;

// Best effort: a leftover only takes up temp space.
export const removeDir = (dir: string): Promise<void> =>
  fs.rm(dir, { recursive: true, force: true }).catch(() => {});

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
