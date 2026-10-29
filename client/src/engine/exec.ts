// Runs ffmpeg and gifski as WebAssembly (built by wasm/Dockerfile), each run a
// fresh instance as each native run is a fresh process: globals, threads and
// heap end with it. The job's files (fs.ts) are lent to the instance's
// filesystem without copying and taken back, with what it wrote, at exit.
import type { Exec } from "@api/ffmpeg";
import { dirs, files } from "./fs";

// The glue must be same-origin: each of a run's threads loads it as its
// worker script. The .wasm can come from any host that sends CORS headers.
export const GLUE_URL = "/engine";
export const WASM_URL: string = import.meta.env.VITE_ENGINE_WASM || GLUE_URL;
export const PROGRAMS = ["ffmpeg", "gifski"] as const;

// Compiled once by the page (index.ts) and handed to each job's worker.
export const modules: Partial<Record<string, WebAssembly.Module>> = {};

// Each filter call waits on all of a graph's slice threads, which costs far
// more here than natively: a Mark preview took 18 s on 32 threads, 0.6 s on 1.
// Codec threads (x264, decoders, PNG) still pay off, so they stay automatic.
const FFMPEG_FIRST = ["-filter_complex_threads", "1"];

const glue = (name: string): Promise<{ default: Factory }> =>
  import(/* @vite-ignore */ `${GLUE_URL}/${name}.mjs`);

const ROOT = "/work";

type Node = { mode: number; contents: Uint8Array<ArrayBuffer> | null; usedBytes: number };
type Instance = {
  FS: {
    mkdirTree(dir: string): void;
    writeFile(file: string, data: Uint8Array, options: { canOwn: boolean }): void;
    readdir(dir: string): string[];
    lookupPath(file: string): { node: Node };
    isDir(mode: number): boolean;
    chdir(dir: string): void;
  };
  callMain(args: string[]): void;
};
type Factory = (settings: object) => Promise<Instance>;

function lend({ FS }: Instance) {
  for (const dir of dirs) if (dir.startsWith(ROOT)) FS.mkdirTree(dir);
  const lent = new Map([...files].filter(([file]) => file.startsWith(`${ROOT}/`)));
  for (const [file, data] of lent) FS.writeFile(file, data, { canOwn: true });
  return lent;
}

// Only what the run wrote or deleted changes the store: runs overlap (a Mark
// preview measures the frame while it prepares the logo), and the job may
// have written files since this run started.
function takeBack({ FS }: Instance, lent: Map<string, Uint8Array>, dir = ROOT) {
  for (const name of FS.readdir(dir)) {
    if (name === "." || name === "..") continue;
    const entry = `${dir}/${name}`;
    const { node } = FS.lookupPath(entry);
    if (FS.isDir(node.mode)) {
      dirs.add(entry);
      takeBack({ FS } as Instance, lent, entry);
      continue;
    }
    if (node.contents !== lent.get(entry)) {
      files.set(entry, node.contents?.subarray(0, node.usedBytes) ?? new Uint8Array());
    }
    lent.delete(entry);
  }
}

export const exec: Exec = async (command, args, { cwd = ROOT }) => {
  const { default: factory } = await glue(command);
  const wasm = modules[command];
  if (!wasm) throw new Error(`Failed to start command: no ${command} module`);
  const started = performance.now();
  let stdout = "";
  let stderr = "";
  let memory: WebAssembly.Memory | undefined;
  let exit: (code: number | null) => void = () => {};
  const exited = new Promise<number | null>((resolve) => (exit = resolve));
  const instance = await factory({
    instantiateWasm(
      imports: WebAssembly.Imports,
      ready: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void,
    ) {
      // Import names are minified; the memory is the one Memory among them.
      memory = Object.values(imports)
        .flatMap((module) => Object.values(module))
        .find((value) => value instanceof WebAssembly.Memory);
      void WebAssembly.instantiate(wasm, imports).then((instance) => ready(instance, wasm));
      return {};
    },
    print: (line: string) => (stdout += `${line}\n`),
    printErr: (line: string) => (stderr += `${line}\n`),
    onExit: exit,
    // A trap or out-of-memory: like a crashed process, no exit code.
    onAbort: (reason: unknown) => {
      stderr += `${String(reason)}\n`;
      exit(null);
    },
  });
  const lent = lend(instance);
  instance.FS.chdir(cwd);
  instance.callMain(command === "ffmpeg" ? [...FFMPEG_FIRST, ...args] : args);
  const code = await exited;
  takeBack(instance, lent);
  for (const [file, data] of lent) if (files.get(file) === data) files.delete(file);
  const heap = (memory?.buffer.byteLength ?? 0) / 2 ** 20;
  console.log(
    `${command} exit ${code}: ${Math.round(performance.now() - started)} ms, heap ${heap} MB`,
  );
  return { code, stdout, stderr };
};
