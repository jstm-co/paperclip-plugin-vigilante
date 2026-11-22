// Job, action and data handlers, kept apart from worker.ts (which starts the
// worker on import) so they can be tested with a fake context.
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { runScan, scanCompany, stateScope } from "./scan.js";
import { ACTION_SCAN_NOW, CONFIG_ENABLED, DATA_REPORT, JOB_SCAN, type Report } from "./shared.js";
import { parseState } from "./snapshot.js";

/**
 * Companies whose per-company switch is on. The host replays every saved company
 * config to `onConfigChanged` when the worker starts and on each save, so this
 * set is rebuilt without any listing call.
 */
export function applyConfig(enabled: Set<string>, config: Record<string, unknown> | null | undefined, companyId: string | null | undefined): void {
  if (!companyId) return;
  if (config?.[CONFIG_ENABLED] === true) enabled.add(companyId);
  else enabled.delete(companyId);
}

function requireCompanyId(params: Record<string, unknown>): string {
  const companyId = params.companyId;
  if (typeof companyId !== "string" || companyId.length === 0) throw new Error("companyId is required");
  return companyId;
}

export function registerHandlers(ctx: PluginContext, enabled: ReadonlySet<string>): void {
  // One scan at a time: the job and "Scan now" share this queue.
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  // The job has no company scope, so it never lists companies: it scans the
  // ones with the switch on, each inside its own proactive scope.
  ctx.jobs.register(JOB_SCAN, async () => {
    const outcomes = await serialized(() => runScan(ctx, [...enabled]));
    for (const outcome of outcomes) if (!outcome.ok) ctx.logger.warn("vigilante: scan failed for a company", { companyId: outcome.companyId, error: outcome.error });
  });

  // "Scan now" rescans only the company the user is looking at, even with its switch off.
  ctx.actions.register(ACTION_SCAN_NOW, async (params) => {
    const companyId = requireCompanyId(params);
    const [outcome] = await serialized(() => runScan(ctx, [companyId]));
    if (outcome && !outcome.ok) throw new Error(outcome.error ?? "scan failed");
    return { ok: true };
  });

  ctx.data.register(DATA_REPORT, async (params): Promise<Report> => {
    const companyId = requireCompanyId(params);
    const state = parseState(await ctx.state.get(stateScope(companyId)));
    return { enabled: enabled.has(companyId), company: state.company, errors: state.errors };
  });
}
