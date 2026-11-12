export const TYPED = new Set(["composer", "bridge", "sdk"]);

export function isTypedOrigin(origin: { kind: string; asUser?: boolean }): boolean {
  return TYPED.has(origin.kind) || origin.kind === "slack-ping" || origin.asUser === true;
}
