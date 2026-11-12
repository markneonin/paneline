export type UsageOptions = {
  input?: number;
  output?: number;
  write5m?: number;
  write1h?: number;
  read?: number;
};

export type AdvisorOptions = UsageOptions & { model: string };

export type LineOptions = UsageOptions & {
  id: string;
  at: number;
  sessionId?: string;
  cwd?: string;
  model?: string;
  speed?: "fast" | "standard";
  geo?: "us" | "global";
  searches?: number;
  isUnsplit?: boolean;
  isSpaced?: boolean;
  isTopLevelZeroed?: boolean;
  advisors?: AdvisorOptions[];
};

export const OPUS = "claude-opus-5-5";

function iterationOf(
  type: string,
  options: UsageOptions,
  isUnsplit: boolean,
): Record<string, unknown> {
  return { type, ...tokenFields(options, isUnsplit) };
}

function tokenFields(options: UsageOptions, isUnsplit: boolean): Record<string, unknown> {
  const write5m = options.write5m ?? 0;
  const write1h = options.write1h ?? 0;
  return {
    input_tokens: options.input ?? 0,
    output_tokens: options.output ?? 0,
    cache_read_input_tokens: options.read ?? 0,
    cache_creation_input_tokens: write5m + write1h,
    ...(isUnsplit
      ? {}
      : {
          cache_creation: {
            ephemeral_5m_input_tokens: write5m,
            ephemeral_1h_input_tokens: write1h,
          },
        }),
  };
}

export function assistantLine(options: LineOptions): string {
  const isUnsplit = options.isUnsplit ?? false;
  const line = JSON.stringify({
    type: "assistant",
    sessionId: options.sessionId,
    cwd: options.cwd,
    timestamp: new Date(options.at).toISOString(),
    requestId: `req_${options.id}`,
    message: {
      id: options.id,
      model: options.model ?? OPUS,
      usage: {
        ...tokenFields(options.isTopLevelZeroed === true ? {} : options, isUnsplit),
        server_tool_use: { web_search_requests: options.searches ?? 0, web_fetch_requests: 0 },
        speed: options.speed ?? "standard",
        inference_geo: options.geo ?? "global",
        iterations: [
          iterationOf("message", options, isUnsplit),
          ...(options.advisors ?? []).map((advisor) => ({
            ...iterationOf("advisor_message", advisor, isUnsplit),
            model: advisor.model,
          })),
        ],
      },
    },
  });
  return options.isSpaced ? line.replaceAll('":', '": ') : line;
}

export function userLine(at: number): string {
  return JSON.stringify({
    type: "user",
    timestamp: new Date(at).toISOString(),
    message: { role: "user", content: 'the words "type":"assistant" and "usage" in plain text' },
  });
}
