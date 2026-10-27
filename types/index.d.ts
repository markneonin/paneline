export type Activity = {
  id: string;
  tool: string;
  target: string;
  ms: number;
  isErrored: boolean;
  added: number;
  removed: number;
};

export type AgentEdit = Activity & { agentId: string };

export type GitChange = {
  target: string;
  added: number;
  removed: number;
  label: string;
  base: string;
};

export type FilesDiff = { target: string; text: string };

export type CallRecord = Activity & { agentId?: string; input: string; output: string };

export type RunningCall = { callId: string; tool: string; target: string };

export type TurnStats = { reads: number; commands: number; changedFiles: number };

export type UsageSnap = {
  context: number | null;
  limits: { label: string; percent: number; resetsAt?: string }[];
};

export type PromptInfo = { model: string; effort: string | null; cwd: string };

export type AgentStatus = "running" | "waiting" | "idle" | "done" | "failed" | "stopped" | "killed";

export type AgentNode = {
  id: string;
  parentId?: string;
  type: string;
  description: string;
  name?: string;
  background: boolean;
  model: string;
  effort?: string;
  status: AgentStatus;
  startedAt: number;
  endedAt?: number;
  ctxTokens: number;
  tokensIn: number;
  tokensOut: number;
  running: RunningCall[];
  branch?: string;
  worktree?: string;
};

export type AgentTree = Record<string, AgentNode>;

export type SpendOwner = { weight: number; pricedTokens: number; unpricedTokens: number };

export type SpendMiss = { at: number; cause: string; rebuilt: number; usd: number | null };

export type SpendRent = { tool: string; target: string; tokens: number };

export type SpendMemory = {
  model: string;
  endedAt: number;
  size: number | undefined;
  ttl?: "5m" | "1h";
};

export type SpendState = {
  owners: Record<string, SpendOwner>;
  mainModel: string;
  cacheReadTokens: number;
  promptTokens: number;
  missCount: number;
  lostUsd: number;
  misses: SpendMiss[];
  rentTokens: number;
  rent: SpendRent[];
  isCompacted: boolean;
  growthSum: number;
  growthCount: number;
  mainCacheTtl: "5m" | "1h" | null;
  baselineUsd: number | null;
  mainMemory: SpendMemory | null;
  agentMemories: Record<string, SpendMemory>;
};

declare module "claude-code" {
  interface PluginState {
    paneline: {
      activity: Activity[];
      agentEdits: AgentEdit[];
      gitChanges: GitChange[];
      gitBranches: Record<string, string>;
      calls: CallRecord[];
      openCall: string | null;
      running: RunningCall[];
      toolMs: StateFamily<number>;
      turnStats: StateFamily<TurnStats | null>;
      totalMs: number;
      activityCleared: { ids: string[]; totalMs: number };
      filesCleared: string[];
      agentsCleared: string[];
      usage: UsageSnap;
      tab: string;
      filesFolded: Record<string, boolean>;
      filesDiff: FilesDiff | null;
      mcpSeen: string[];
      mcpQueued: string[];
      mcpOpen: string[];
      planDoneOpen: boolean;
      measureStamp: number;
      launchFolder: string;
      skillUses: Record<string, number>;
      toolUses: Record<string, number>;
      skillsStatsOpen: boolean;
      skillsExpanded: string[];
      agents: Record<string, AgentNode>;
      agentsTick: number;
      sessionUsd: number | null;
      spend: SpendState;
      promptInfo: PromptInfo;
      sessionColor: string;
      theme: string;
      transcriptPath: string;
      progress: {
        tasks: Record<string, { status: "pending" | "in_progress" | "completed"; title: string }>;
        percent: number | null;
      };
      callsSinceNote: number;
    };
  }
}
