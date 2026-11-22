import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { CONFIG_ACT, CONFIG_ACT_AFTER, CONFIG_ENABLED, CONFIG_LANGUAGE, JOB_SCAN, PAGE_ROUTE } from "./shared.js";

declare const __VIGILANTE_VERSION__: string;

const manifest: PaperclipPluginManifestV1 = {
  id: "jstm.vigilante",
  apiVersion: 1,
  version: __VIGILANTE_VERSION__,
  displayName: "Vigilante",
  description: "Watches chains of blocked issues and reports the stopper issue nobody moves. Watch-only by default; opt-in per company, it wakes the agent another agent is waiting for.",
  author: "JSTM",
  categories: ["automation", "ui"],
  // Watching is the default. The plugin reads issues, companies and agents, keeps
  // one snapshot in its own plugin state, and shows a page. Its only acting
  // feature is opt-in per company (`act`): it can WAKE an agent (`agents.invoke`)
  // and write an activity entry (`activity.log.write`). It still has NO
  // `issues.update`, NO `issues.wakeup`, NO comment capability and NO relation
  // writes, so it cannot edit issues, comment or change relations. Adding
  // capabilities makes `plugin upgrade` reject the new manifest: existing
  // installs must uninstall and reinstall the plugin.
  capabilities: [
    "companies.read",
    "issues.read",
    // Read-only: which issues block an open one that is not `blocked` itself.
    "issue.relations.read",
    "jobs.schedule",
    "plugin.state.read",
    "plugin.state.write",
    // Read the company's agents to match the names an explanation text mentions.
    "agents.read",
    // Acting (opt-in per company): wake the agent another agent is waiting for.
    "agents.invoke",
    // The trail of each wake, on the issue, attributed to the plugin.
    "activity.log.write",
    "ui.page.register",
    "ui.sidebar.register",
    // For the top toolbar button: the default "Coordinator" workspace does not draw
    // `sidebar` slots, so without the button the page would be unreachable.
    "ui.action.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  // Saved once per company. The 15-minute scan has no company scope, so it can only
  // touch the companies that have a saved config; it scans those with `enabled` on.
  instanceConfigSchema: {
    type: "object",
    properties: {
      [CONFIG_ENABLED]: {
        type: "boolean",
        title: "Scan this company every 15 minutes",
        description:
          "When on, Vigilante scans this company's blocked chains every 15 minutes. When off, only the Scan now button on the Vigilante page scans it. Scanning alone changes nothing; see \"Act\" for the one thing the plugin can do.",
        default: false,
      },
      [CONFIG_ACT]: {
        type: "boolean",
        title: "Wake the agent another agent is waiting for",
        description:
          "Off by default (watch-only). When on, and the scan runs for this company, Vigilante wakes the agent named in the explanation of a blocked issue nobody moves, at most once every 24 hours and 3 times per issue, 5 per scan. Nothing else is changed.",
        default: false,
      },
      [CONFIG_ACT_AFTER]: {
        type: "integer",
        title: "Minutes quiet before waking an agent",
        description: "A blocked issue that names another agent is woken for only after nothing has moved on it for this many minutes. Minimum 10.",
        default: 30,
        minimum: 10,
      },
      [CONFIG_LANGUAGE]: {
        type: "string",
        title: "Language of the wake-up message",
        description: "Language of the automatic message sent to the woken agent and of the activity entry.",
        enum: ["en", "es"],
        default: "en",
      },
    },
  },
  jobs: [
    {
      jobKey: JOB_SCAN,
      displayName: "Scan blocked chains",
      description: "Finds the issues that blocked chains hang from and stores a report. Wakes an agent only for companies with Act on.",
      schedule: "*/15 * * * *",
    },
  ],
  ui: {
    slots: [
      {
        type: "page",
        id: "vigilante-page",
        displayName: "Vigilante",
        exportName: "VigilantePage",
        routePath: PAGE_ROUTE,
      },
      {
        type: "sidebar",
        id: "vigilante-sidebar",
        displayName: "Vigilante",
        exportName: "VigilanteSidebarLink",
      },
      {
        type: "globalToolbarButton",
        id: "vigilante-toolbar",
        displayName: "Vigilante",
        exportName: "VigilanteToolbarButton",
      },
    ],
  },
};

export default manifest;
