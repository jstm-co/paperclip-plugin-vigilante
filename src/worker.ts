import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { applyConfig, registerHandlers } from "./handlers.js";

/** Companies with the per-company switch on (see `applyConfig`). */
const enabled = new Set<string>();

const plugin = definePlugin({
  // The switch is saved per company; one worker serves all of them.
  multiCompanyConfig: true,

  async setup(ctx) {
    registerHandlers(ctx, enabled);
  },

  async onConfigChanged(config, context) {
    applyConfig(enabled, config, context?.companyId);
  },

  async onHealth() {
    return { status: "ok", message: "Vigilante worker running (watch-only)" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
