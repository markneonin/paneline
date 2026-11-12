import type { Engine } from "claude-code/testing";

import { mainTurn, usageOf } from "../spend-world";
import type { Tokens, World } from "../spend-world";

export type MainResponses = {
  model: string;
  responses: Tokens[];
  context?: number;
  durationMs?: number;
};

export async function mainResponse(
  $: Engine,
  world: World,
  model: string,
  tokens: Tokens,
  index: number,
): Promise<void> {
  world.stepUsage = usageOf(model, tokens);
  const stream = $.turn.step({
    turnId: "turn-main",
    index,
    model,
    effort: "high",
    messageCount: 1,
  } as never);
  for await (const _chunk of stream) continue;
}

export async function mainResponsesOnly(
  $: Engine,
  world: World,
  turn: MainResponses,
): Promise<void> {
  for (const [index, tokens] of turn.responses.entries()) {
    await mainResponse($, world, turn.model, tokens, index);
  }
}

export async function mainTurnOfResponses(
  $: Engine,
  world: World,
  turn: MainResponses,
): Promise<void> {
  await mainResponsesOnly($, world, turn);
  await mainTurn($, world, {
    model: turn.model,
    isStepped: true,
    tokens: summed(turn.responses),
    ...(turn.context === undefined ? {} : { context: turn.context }),
    ...(turn.durationMs === undefined ? {} : { durationMs: turn.durationMs }),
  });
}

function summed(responses: Tokens[]): Tokens {
  const total = (pick: (tokens: Tokens) => number | undefined): number =>
    responses.reduce((sum, tokens) => sum + (pick(tokens) ?? 0), 0);
  return {
    input: total((tokens) => tokens.input),
    output: total((tokens) => tokens.output),
    read: total((tokens) => tokens.read),
    write: total((tokens) => tokens.write),
  };
}
