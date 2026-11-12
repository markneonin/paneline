export type Activity = {
  id: string;
  tool: string;
  target: string;
  ms: number;
  isErrored: boolean;
  reason?: string;
  fallbackReason?: string;
  added: number;
  removed: number;
  files?: { target: string; added: number; removed: number }[];
};

export type AgentEdit = Activity & { agentId: string };

export type GitChange = {
  target: string;
  added: number;
  removed: number;
  label: string;
  base: string;
  landedBy?: string[];
};

export type FilesDiff = { target: string; text: string };

export type CallDetail =
  | {
      kind: "bash";
      command: string;
      stdout: string;
      stderr: string;
      exitCode: number | null;
      tag: string;
      droppedLines: number;
    }
  | {
      kind: "change";
      filePath: string;
      isCreate: boolean;
      hunks: {
        oldStart: number;
        oldLines: number;
        newStart: number;
        newLines: number;
        lines: string[];
      }[];
      content: string;
    }
  | {
      kind: "read";
      filePath: string;
      content: string;
      startLine: number;
      numLines: number;
      totalLines: number;
    };

export type Worktree = {
  path: string;
  label: string;
  isMain: boolean;
  isSession: boolean;
  isDetached: boolean;
  isLocked: boolean;
  isClean: boolean;
  isMerged: boolean;
};

export type WorktreeOpen = { path: string; isConfirming: boolean };

export type Shell = {
  id: string;
  command: string;
  startedAt: number;
  outputPath: string | undefined;
  status: "running" | "done" | "killed";
  endedAt?: number;
};

export type ShellOpen = { id: string; isConfirming: boolean };

export type ListeningPort = { port: number; command: string; pid: number };

export type ReviewHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
};

export type ReviewListFile = {
  path: string;
  status: "added" | "modified" | "deleted";
  isBinary: boolean;
  added: number;
  removed: number;
  base: string;
  isCommentOnly: boolean;
  stamp: string;
};

export type ReviewListComment = {
  id: string;
  file: string;
  line: number;
  side: "new" | "old";
  code: string;
  text: string;
  resolved: boolean;
};

export type PressedLine = { side: "new" | "old"; line: number; code: string };
export type ReviewDraft = PressedLine & { opening: number };

export type ReviewConfirm = { kind: "file" } | { kind: "hunk"; index: number };

export type ReviewState = {
  scope: "session" | "uncommitted" | "main";
  top: string | null;
  reason: string | null;
  files: ReviewListFile[];
  comments: ReviewListComment[];
  openPath: string | null;
  hunks: ReviewHunk[];
  isDiffCut: boolean;
  confirm: ReviewConfirm | null;
  error: string | null;
  draft: ReviewDraft | null;
  seen: Record<string, string>;
  dropped: string[];
};

export type CallCounts = { kinds: Partial<Record<string, number>>; errors: number };

export type CallRecord = Activity & {
  agentId?: string;
  launchedAgentId?: string;
  permission?: { kind: "denied" | "auto-allowed"; reason: string };
  startedAt?: number;
};

export type CallBody = {
  input: string;
  fields?: { name: string; value: string }[];
  output: string;
  detail?: CallDetail;
};

export type RunningCall = { callId: string; tool: string; target: string; startedAt?: number };

export type SessionRow = {
  pid: number;
  sessionId: string;
  state: AgentStatus;
  cwd: string;
  branch: string;
  ctx: number | null;
  usd: number | null;
  since?: number | null;
  statusWord?: string | null;
  transcriptPath?: string | null;
};

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
  batch?: string;
  running: RunningCall[];
  branch?: string;
  worktree?: string;
};

export type AgentTree = Record<string, AgentNode>;

export type TranscriptState = "reading" | "read" | "unreadable";

export type HistoryEntry = {
  kind: "prompt" | "reply";
  id: string;
  at: number;
  tools?: number;
  failed?: number;
  ms?: number;
  absorbed?: true;
};

export type PastMatch = {
  date: string;
  project: string;
  branch: string;
  line: string;
  isReply?: true;
  sessionId?: string;
  cwd?: string;
};

export type SpendOwner = { weight: number; pricedTokens: number; unpricedTokens: number };

export type SpendAgent = SpendOwner & { owner: string };

export type SpendMiss = { at: number; cause: string; rebuilt: number; usd: number | null };

export type SpendRent = { tool: string; target: string; tokens: number; callId?: string };

export type CompactionRow = { at: number; before: number | null; after: number | null };

export type RepeatRow = { tool: string; target: string; count: number; tokens: number };

export type ContextLog = {
  compactions: CompactionRow[];
};

export type SpendMemory = {
  model: string;
  endedAt: number;
  size: number | undefined;
  ttl?: "5m" | "1h";
};

export type SpendLastTurn = {
  durationMs: number;
  usd: number;
  tokens: number;
  agents: number;
  contextTokens: number | null;
};

export type TranscriptProgress = { doneBytes: number; totalBytes: number; failed: number };

export type SpendProject = { name: string; usd: number };

export type SpendSlice = {
  project: string;
  session: string;
  day: string;
  at: number;
  usd: number;
  isOwn: boolean;
};

export type SpendTotals = {
  at: number;
  today?: number;
  week?: number;
  month?: number;
  lastHour?: number;
  projects?: SpendProject[];
  session?: number | null;
  progress?: TranscriptProgress | null;
  slices?: SpendSlice[];
  activeHours?: number;
};

export type SpendState = {
  owners: Record<string, SpendOwner>;
  agents: Record<string, SpendAgent>;
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
  lastTurn: SpendLastTurn | null;
};

export type RemoteCi = "pass" | "fail" | "pending" | "none";
export type RemoteReview = { kind: "PR" | "MR"; number: number; ci: RemoteCi; threads: number };
export type RemoteRepo = {
  branch: string;
  ahead: number | null;
  behind: number | null;
  review?: RemoteReview | null;
};

declare module "claude-code" {
  interface PluginState {
    paneline: {
      activity: Activity[];
      agentEdits: AgentEdit[];
      gitChanges: GitChange[];
      gitBranches: Record<string, string>;
      calls: Shaped<CallRecord[]>;
      openCall: string | null;
      spendOpen: { project?: string; day?: string; unfolded: string[] };
      callLookup: { id: string; call: (CallRecord & CallBody) | null } | null;
      unfoldedCall: string | null;
      openDiagram: string | null;
      running: RunningCall[];
      toolMs: StateFamily<number>;
      denied: StateFamily<boolean>;
      messageAt: StateFamily<number>;
      messageSearched: StateFamily<boolean>;
      turnStats: StateFamily<TurnStats | null>;
      totalMs: number;
      callCounts: CallCounts;
      activityCleared: {
        ids: string[];
        totalMs: number;
        counts?: CallCounts;
        modelMs?: number;
        toolsMs?: number;
        youMs?: number;
      };
      waiting: { callId: string; since: number; isMain: boolean }[];
      waitTick: number;
      timeSplit: { modelMs: number; toolsMs: number; youMs: number };
      filesCleared: string[];
      agentsCleared: string[];
      openAgent: string | null;
      expandedAgent: string | null;
      usage: UsageSnap;
      tab: string;
      filesFolded: Record<string, boolean>;
      filesDiff: FilesDiff | null;
      filesWorktrees: Worktree[];
      filesWorktreeOpen: WorktreeOpen | null;
      shells: Shell[];
      shellsCheckedAt: number;
      shellsTails: Record<string, string[]>;
      shellOpen: ShellOpen | null;
      shellsPorts: ListeningPort[] | null;
      review: ReviewState;
      mcpSeen: string[];
      mcpQueued: string[];
      mcpOpen: string[];
      planDoneOpen: boolean;
      measureStamp: number;
      launchFolder: string;
      skillUses: Record<string, number>;
      toolUses: Record<string, number>;
      toolFailures: Record<string, number>;
      skillsStatsOpen: boolean;
      skillsNeverOpen: boolean;
      skillOverridesRev: number;
      skillsExpanded: string[];
      skillsFilter: string;
      activityFilter: string;
      allowedOpen: boolean;
      failedOpen: boolean;
      filesFilter: string;
      agents: Record<string, AgentNode>;
      agentsTick: number;
      sessions: Record<string, SessionRow>;
      openSession: number | null;
      sessionsSynced: boolean;
      sessionUsd: number | null;
      sessionCosts: Record<string, number>;
      spend: SpendState;
      spendTotals: SpendTotals | null;
      contextLog: ContextLog;
      history: HistoryEntry[];
      historyFilter: string;
      historyPast: PastMatch[] | null;
      historySelected: string;
      historyOpenReplies: string[];
      historyOpenProjects: string[];
      remote: Record<string, RemoteRepo>;
      promptInfo: PromptInfo;
      sessionColor: string;
      theme: string;
      bodyOffset: number;
      setupHook: { id: string; listOffset: number } | null;
      transcriptPath: string;
      progress: {
        tasks: Record<string, { status: "pending" | "in_progress" | "completed"; title: string }>;
        percent: number | null;
      };
      callsSinceNote: number;
      mainTurnRunning: boolean;
      reviewResolved: number;
      historyTranscript: TranscriptState;
      listOffsets: Record<string, number>;
      reviewDiscardArmed: boolean;
    };
  }
}
