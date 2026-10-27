export function isHeavy(props: { weight?: unknown } | undefined): boolean {
  return props?.weight === "semibold" || props?.weight === "bold";
}
