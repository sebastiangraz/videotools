// Bun's `with { type: "file" }` import: the file's path (embedded when compiled).
declare module "*.wasm" {
  const path: string;
  export default path;
}
