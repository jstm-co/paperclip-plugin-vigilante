// Job, action and data handlers, kept apart from worker.ts (which starts the
// worker on import) so they can be tested with a fake context.
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { runScan, scanCompany, stateScope } from "./scan.js";
import { ACTION_SCAN_NOW, DATA_REPORT, DEFAULT_CONFIG, JOB_SCAN, parseConfig, type CompanyConfig, type Report } from "./shared.js";
import { parseState } from "./snapshot.js";

/**
 * Keeps the saved config of every company. The host replays every saved company
 * config to `onConfigChanged` when the worker starts and on each save, so this
 * map is rebuilt without any listing call. Invalid values fall back to defaults.
 */
export function applyConfig(configs: Map<string, CompanyConfig>, config: Record<string, unknown> | null | undefined, companyId: string | null | undefined): void {
  if (!companyId) return;
  configs.set(companyId, parseConfig(config));
}

function requireCompanyId(params: Record<string, unknown>): string {
  const companyId = params.companyId;
  if (typeof companyId !== "string" || companyId.length === 0) throw new Error("companyId is required");
  return companyId;
}

export function registerHandlers(ctx: PluginContext, configs: ReadonlyMap<string, CompanyConfig>): void {
  const configFor = (companyId: string) => configs.get(companyId) ?? DEFAULT_CONFIG;
  const enabledIds = () => [...configs].filter(([, config]) => config.enabled).map(([id]) => id);

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
    const outcomes = await serialized(() => runScan(ctx, enabledIds(), { configFor }));
    for (const outcome of outcomes) if (!outcome.ok) ctx.logger.warn("vigilante: scan failed for a company", { companyId: outcome.companyId, error: outcome.error });
  });

  // "Scan now" rescans only the company the user is looking at, even with its switch off; it acts when `act` is on.
  ctx.actions.register(ACTION_SCAN_NOW, async (params) => {
    const companyId = requireCompanyId(params);
    const [outcome] = await serialized(() => runScan(ctx, [companyId], { configFor }));
    if (outcome && !outcome.ok) throw new Error(outcome.error ?? "scan failed");
    return { ok: true };
  });

  ctx.data.register(DATA_REPORT, async (params): Promise<Report> => {
    const companyId = requireCompanyId(params);
    const state = parseState(await ctx.state.get(stateScope(companyId)));
    const config = configFor(companyId);
    return { enabled: config.enabled, act: config.act, company: state.company, errors: state.errors };
  });
}
