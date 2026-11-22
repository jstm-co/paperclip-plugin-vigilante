import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { runScan } from "./scan.js";
import { ACTION_SCAN_NOW, DATA_REPORT, JOB_SCAN, STATE_KEY, type Report } from "./shared.js";
import { parseStored } from "./snapshot.js";

const SCOPE = { scopeKind: "instance", stateKey: STATE_KEY } as const;

/**
 * One scan at a time, and the state write is serialized: `set` replaces the
 * whole value, so two overlapping scans must not interleave.
 */
function registerScan(ctx: PluginContext) {
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const scan = (): Promise<Report> =>
    serialized(async () => {
      const previous = await ctx.state.get(SCOPE);
      const { snapshot, firstSeen } = await runScan(ctx, { previous });
      // Paperclip 2026.824.1: instance-scope state has a NULL scope_id, so the unique
      // index does not see a conflict and `set` adds another row. Deleting first keeps one.
      await ctx.state.delete(SCOPE);
      await ctx.state.set(SCOPE, { snapshot, firstSeen });
      return snapshot;
    });

  ctx.jobs.register(JOB_SCAN, async () => {
    await scan();
  });
  ctx.actions.register(ACTION_SCAN_NOW, async () => scan());
  ctx.data.register(DATA_REPORT, async (): Promise<Report> => parseStored(await ctx.state.get(SCOPE)).snapshot);
}

const plugin = definePlugin({
  async setup(ctx) {
    registerScan(ctx);
  },

  async onHealth() {
    return { status: "ok", message: "Vigilante worker running (watch-only)" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
