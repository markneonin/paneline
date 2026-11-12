export type SkillUsage = Record<string, { usageCount?: number; lastUsedAt?: number }>;

export function skillUsageOf(claudeJsonText: string): SkillUsage | null {
  try {
    const config = JSON.parse(claudeJsonText) as { skillUsage?: unknown } | null;
    if (typeof config !== "object" || config === null) return null;
    const usage = config.skillUsage;
    return typeof usage === "object" && usage !== null && !Array.isArray(usage)
      ? (usage as SkillUsage)
      : {};
  } catch {
    return null;
  }
}
