export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function shortenFilename(file: File, length = 24): string {
  if (file.name.length <= length) return file.name;
  const [, ...rest] = file.name.split(".");
  const ext = rest.at(-1) ?? "";
  return `${file.name.slice(0, length)} … ${ext}`;
}
