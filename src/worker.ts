import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { applyConfig, registerHandlers } from "./handlers.js";
import type { CompanyConfig } from "./shared.js";

/** Saved config per company (see `applyConfig`). */
const configs = new Map<string, CompanyConfig>();

const plugin = definePlugin({
  // The switch is saved per company; one worker serves all of them.
  multiCompanyConfig: true,

  async setup(ctx) {
    registerHandlers(ctx, configs);
  },

  async onConfigChanged(config, context) {
    applyConfig(configs, config, context?.companyId);
  },

  async onHealth() {
    return { status: "ok", message: "Vigilante worker running" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
