import type { SpendState } from "../../types";
import { afterAgentRequest, emptySpend } from "../../hooks/spend-model";
import { UNPRICED, usageOf } from "../spend-world";
import type { Tokens } from "../spend-world";

export const PRICED_MODEL = "claude-sonnet-4-5";
export const OPUS_MODEL = "claude-opus-4-5";

export type Spent = { id: string; type: string; model: string; tokens: Tokens };
export type SpendSeed = { spend: SpendState; sessionUsd: number };

export function pricedSpent(id: string, type: string, tokens: Tokens): Spent {
  return { id, type, model: PRICED_MODEL, tokens };
}

export function unpricedSpent(id: string, type: string, tokens: Tokens): Spent {
  return { id, type, model: UNPRICED, tokens };
}

export function seedOf(spent: readonly Spent[]): SpendSeed {
  const spend = spent.reduce(
    (state, one, index) =>
      afterAgentRequest(state, one.type, {
        agentId: one.id,
        index,
        usage: usageOf(one.model, one.tokens),
        startedAt: 0,
        endedAt: 1,
      }),
    emptySpend(),
  );
  const owners = Object.values(spend.owners);
  const pricedTokens = owners.reduce((sum, owner) => sum + owner.pricedTokens, 0);
  const weights = owners.reduce((sum, owner) => sum + owner.weight, 0);
  const usdPerToken = pricedTokens === 0 ? 1 : weights / pricedTokens;
  const sessionUsd = owners.reduce(
    (sum, owner) => sum + owner.weight + owner.unpricedTokens * usdPerToken,
    0,
  );
  return { spend, sessionUsd };
}
