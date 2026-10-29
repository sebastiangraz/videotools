// node:path for the tools in the engine worker (vite.config.ts aliases it
// here): the posix calls they make, on the absolute paths of fs.ts.
const normalize = (parts: string[]): string => {
  const out: string[] = [];
  for (const part of parts.join("/").split("/")) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return `/${out.join("/")}`;
};

const basename = (file: string): string => file.slice(file.lastIndexOf("/") + 1);

const extname = (file: string): string => {
  const name = basename(file);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
};

const path = {
  join: (...parts: string[]) => normalize(parts),
  dirname: (file: string) => normalize([file, ".."]),
  basename,
  extname,
};

export default { ...path, posix: path };
