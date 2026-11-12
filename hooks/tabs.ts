import type { On } from "claude-code";

import { ACTIVITY_TAB, registerActivityTab } from "./activity-tab";
import { AGENTS_TAB, registerAgentsTab } from "./agents-tab";
import { CONTEXT_TAB, registerContextTab } from "./context-tab";
import { FILES_TAB, registerFilesTab } from "./files-tab";
import { HISTORY_TAB, registerHistoryTab } from "./history-tab";
import { MCP_TAB, registerMcpTab } from "./mcp-tab";
import { PLAN_TAB, registerPlanTab } from "./plan-tab";
import { registerReviewTab, REVIEW_TAB } from "./review-tab";
import { registerSessionsTab, SESSIONS_TAB } from "./sessions-tab";
import { registerSetupTab, SETUP_TAB } from "./setup-tab";
import { registerShellsTab, SHELLS_TAB } from "./shells-tab";
import { registerSkillsTab, SKILLS_TAB } from "./skills-tab";
import { registerSpendTab, SPEND_TAB } from "./spend-tab";
import type { TabEntry } from "./tab-bar";

export const TABS: [TabEntry, ...TabEntry[]] = [
  ACTIVITY_TAB,
  FILES_TAB,
  AGENTS_TAB,
  PLAN_TAB,
  CONTEXT_TAB,
  MCP_TAB,
  SKILLS_TAB,
  SPEND_TAB,
  SETUP_TAB,
  SHELLS_TAB,
  HISTORY_TAB,
  REVIEW_TAB,
  SESSIONS_TAB,
];

export function registerTabs(on: On): void {
  registerActivityTab(on);
  registerFilesTab(on);
  registerAgentsTab(on);
  registerPlanTab(on);
  registerContextTab(on);
  registerMcpTab(on);
  registerSkillsTab(on);
  registerSpendTab(on);
  registerSetupTab(on);
  registerShellsTab(on);
  registerHistoryTab(on);
  registerReviewTab(on);
  registerSessionsTab(on);
}
