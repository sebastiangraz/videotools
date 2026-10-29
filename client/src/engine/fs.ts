// node:fs/promises for the tools in the engine worker (vite.config.ts aliases
// it here). A job's files live in memory, outside any WebAssembly heap;
// exec.ts lends them to each ffmpeg/gifski run without copying.
import path from "./path";

export const files = new Map<string, Uint8Array<ArrayBuffer>>();
export const dirs = new Set<string>(["/"]);

const missing = (file: string) =>
  Object.assign(new Error(`ENOENT: no such file, '${file}'`), { code: "ENOENT" });

const read = (file: string): Uint8Array<ArrayBuffer> => {
  const data = files.get(file);
  if (!data) throw missing(file);
  return data;
};

const under = (dir: string) => (file: string) => file.startsWith(`${dir}/`);

export default {
  async mkdir(dir: string) {
    for (let at = dir; !dirs.has(at); at = path.dirname(at)) dirs.add(at);
  },
  async writeFile(file: string, data: string | Uint8Array<ArrayBuffer>) {
    files.set(file, typeof data === "string" ? new TextEncoder().encode(data) : data);
  },
  async readFile(file: string) {
    return read(file);
  },
  async copyFile(from: string, to: string) {
    files.set(to, read(from));
  },
  async rename(from: string, to: string) {
    files.set(to, read(from));
    files.delete(from);
  },
  async stat(file: string) {
    return { size: read(file).length };
  },
  async readdir(dir: string) {
    return [...files.keys(), ...dirs]
      .filter((entry) => entry !== dir && path.dirname(entry) === dir)
      .map(path.basename);
  },
  async rm(target: string, { force = false } = {}) {
    const found = files.delete(target) || dirs.delete(target);
    for (const entry of [...files.keys()].filter(under(target))) files.delete(entry);
    for (const entry of [...dirs].filter(under(target))) dirs.delete(entry);
    if (!found && !force) throw missing(target);
  },
  async open(file: string) {
    const data = read(file);
    return {
      async read(buffer: Uint8Array, offset: number, length: number, position: number) {
        const bytes = data.subarray(position, position + length);
        buffer.set(bytes, offset);
        return { bytesRead: bytes.length };
      },
      async close() {},
    };
  },
};
