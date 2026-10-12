import type { Register } from "claude-code";

import { trackActivity } from "./activity-track";
import { trackAgents } from "./agents-track";
import { renderChat } from "./chat-render";
import { trackGit } from "./git-track";
import { trackMcpUses } from "./mcp-track";
import { registerProbe } from "./probe";
import { trackPromptInfo } from "./prompt-track";
import { registerSessionCommand, registerSessionPane } from "./session-pane";
import { trackSkills } from "./skills-track";
import { trackSpend } from "./spend-track";
import { registerTabs } from "./tabs";
import { trackTheme } from "./theme-track";
import { trackUsage } from "./usage-track";

export const register: Register = (on, options) => {
  if (options.probe === true) registerProbe(on);
  registerSessionPane(on);
  trackAgents(on);
  trackGit(on);
  trackPromptInfo(on);
  trackActivity(on);
  trackUsage(on);
  trackTheme(on);
  trackSkills(on);
  trackMcpUses(on);
  trackSpend(on);
  registerTabs(on);
  registerSessionCommand(on, options.autoOpen !== false);
  renderChat(on);
};
