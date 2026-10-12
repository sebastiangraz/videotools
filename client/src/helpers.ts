export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// 6 characters of the source, the extras' names, then each option as key
// initials + value (fadeDuration 0.7 → fd0.7, true or a list → Y, false or null
// left out), with the extension of the server's name.
export function verboseName(
  base: string,
  extraNames: string[],
  options: Record<string, unknown>,
  resultName: string,
): string {
  return (
    [
      base.slice(0, 6),
      ...extraNames,
      ...Object.entries(options)
        .filter(([, value]) => value !== false && value !== null)
        .map(
          ([key, value]) =>
            key.replace(/\B[a-z]+/g, "").toLowerCase() +
            (value === true || Array.isArray(value)
              ? "Y"
              : String(value).replace(/(?:^|-)(.)/g, (_, c: string) => c.toUpperCase())),
        ),
    ].join("_") + resultName.slice(resultName.lastIndexOf("."))
  );
}

export function shortenFilename(file: File, length = 24): string {
  if (file.name.length <= length) return file.name;
  const [, ...rest] = file.name.split(".");
  const ext = rest.at(-1) ?? "";
  return `${file.name.slice(0, length)} … ${ext}`;
}
