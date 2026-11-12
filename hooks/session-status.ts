import type { RunningCall } from "../types";
import type { WaitingCall } from "./activity-track";

export type SessionStatus = { word: "thinking" | "working" | "waiting" | "idle"; tool?: string };

export function sessionStatusOf(
  isTurnRunning: boolean,
  running: RunningCall[],
  waiting: WaitingCall[],
): SessionStatus {
  if (waiting.length > 0) return { word: "waiting" };
  if (running[0] !== undefined) return { word: "working", tool: running[0].tool };
  return { word: isTurnRunning ? "thinking" : "idle" };
}
