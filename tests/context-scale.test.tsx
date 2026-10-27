import { describe, expect, mock, test } from "claude-code/testing";
import type { On, SessionContextBreakdown, SessionContextUsage } from "claude-code";
import type { Engine } from "claude-code/testing";

import { screenRows } from "./band-screen";

const HOME = "/Users/dev";
const PROJECT = `${HOME}/workspace/projects/paneline`;
const NOW = 1_800_000_000_000;
const WINDOW = 200_000;
const COMPACTION_THRESHOLD = 160_000;
const TOKENS_AT_40_PERCENT_OF_WINDOW = 80_000;
const WIDE = 200;
const SESSION_START = { cwd: PROJECT, surface: "terminal", isInteractive: true } as const;

describe("the context meter scale", () => {
  test("R21 a later reading without its token count leaves the context meter on the compaction scale it showed before", async ($, on) => {
    const world = worldOf(on);
    await $.session.start(SESSION_START);
    await measureContext($, {
      window: WINDOW,
      tokens: TOKENS_AT_40_PERCENT_OF_WINDOW,
      percent: 40,
    });
    await measureContext($, { window: WINDOW, percent: 30 });
    await world.settle();

    expect(screenRows(await mountBand($, WIDE), WIDE).join("\n")).toContain("≡ 50%");
  });
});

function worldOf(on: On) {
  const clock = mock.clock(on, { now: NOW });
  mock.env(on, { HOME });
  on("session.model", () => ({ value: "claude-opus-5-5" }));
  on("session.cwd", () => ({ value: PROJECT }));
  on("session.usage", () => ({
    value: {
      startedAt: 0,
      context: {
        window: WINDOW,
        breakdown: {
          autoCompactThreshold: COMPACTION_THRESHOLD,
        } as unknown as SessionContextBreakdown,
      },
      rateLimits: [],
    },
  }));
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("command.register", () => ({ value: {} }) as never);
  on("classic.SessionStart", () => ({}));
  on("classic.UserPromptSubmit", () => ({}));
  on("classic.Stop", () => ({}));
  on("classic.PostToolUse", () => ({}));
  on("ui.render", { component: "AbovePrompt" }, ($, e) => {
    const { Text } = $.ui.resolve(e);
    return <Text>engine row</Text>;
  });
  return { settle: () => clock.settle() };
}

function measureContext($: Engine, context: SessionContextUsage): Promise<unknown> {
  return $.session.measure({ context, rateLimits: [], changed: ["context"] });
}

async function mountBand($: Engine, columns: number) {
  const band = await $.ui.mount({
    plugin: "paneline",
    surface: "terminal",
    component: "AbovePrompt",
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns: columns,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
    viewport: { columns, rows: 40 },
  });
  return band.drawn();
}
