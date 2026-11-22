import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { JOB_SCAN, PAGE_ROUTE } from "./shared.js";

declare const __VIGILANTE_VERSION__: string;

const manifest: PaperclipPluginManifestV1 = {
  id: "jstm.vigilante",
  apiVersion: 1,
  version: __VIGILANTE_VERSION__,
  displayName: "Vigilante",
  description: "Watches chains of blocked issues and reports the stopper issue nobody moves. Watch-only: it changes nothing.",
  author: "JSTM",
  categories: ["automation", "ui"],
  // Version 1 is WATCH-ONLY on purpose: it reads issues and companies, keeps one
  // snapshot in its own plugin state, and shows a page. It deliberately has NO
  // `issues.update`, NO `issues.wakeup` and NO comment capability, so it is
  // unable to change anything in Paperclip. Adding capabilities later (the acting
  // version) makes `plugin upgrade` reject the new manifest: users will have to
  // uninstall and reinstall the plugin.
  capabilities: [
    "companies.read",
    "issues.read",
    "jobs.schedule",
    "plugin.state.read",
    "plugin.state.write",
    "ui.page.register",
    "ui.sidebar.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  jobs: [
    {
      jobKey: JOB_SCAN,
      displayName: "Scan blocked chains",
      description: "Finds the issues that blocked chains hang from and stores a report. Read-only.",
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
    ],
  },
};

export default manifest;
