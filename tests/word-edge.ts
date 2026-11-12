const ELLIPSIS = "…";
const SEPARATORS = "-_./ ";

export function isWordEdgeCut(shown: string, original: string): boolean {
  const parts = shown.split(ELLIPSIS);
  const [start = "", end = ""] = parts;
  return (
    parts.length === 2 &&
    original.startsWith(start) &&
    original.endsWith(end) &&
    SEPARATORS.includes(start.slice(-1)) &&
    SEPARATORS.includes(original[original.length - end.length - 1] ?? "")
  );
}
