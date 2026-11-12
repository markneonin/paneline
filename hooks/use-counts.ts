export type UseCounts = Record<string, Record<string, number>>;

export type UseEntry = { name: string; uses: number };

export function savedUses(stored: unknown): UseCounts {
  return (stored ?? {}) as UseCounts;
}

export function withUse(all: UseCounts, folder: string, name: string): UseCounts {
  const inFolder = all[folder] ?? {};
  return { ...all, [folder]: { ...inFolder, [name]: (inFolder[name] ?? 0) + 1 } };
}

export function withoutFolder(all: UseCounts, folder: string): UseCounts {
  return Object.fromEntries(Object.entries(all).filter(([key]) => key !== folder));
}

export function countsIn(all: UseCounts, folder: string): Record<string, number> {
  return all[folder] ?? {};
}

export function rankedUses(counts: Record<string, number>): UseEntry[] {
  return Object.entries(counts)
    .map(([name, uses]) => ({ name, uses }))
    .sort((left, right) => right.uses - left.uses || left.name.localeCompare(right.name));
}
