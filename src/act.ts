// The only action the plugin has: wake the agent another agent is waiting for.
// Limits are enforced from the stored record, so they survive restarts.
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { Stopper } from "./classify.js";
import type { AgentRef } from "./mentions.js";
import { buildActivityMessage, buildPrompt } from "./prompt.js";
import { MAX_NUDGES_PER_SCAN, MAX_NUDGES_PER_STOPPER, NUDGE_SPACING_MS, type CompanyConfig, type NudgeInfo } from "./shared.js";

/** Stable reason string sent to the host with every wake. */
export const NUDGE_REASON = "vigilante_waiting_agent";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Returns the nudge records after this scan: the previous ones of issues that
 * are still stoppers (the rest are dropped), updated by what was done now.
 * Never throws: a failed wake is recorded and the scan goes on.
 */
export async function actOnStoppers(
  ctx: PluginContext,
  companyId: string,
  stoppers: readonly Stopper[],
  agents: readonly AgentRef[],
  previous: Readonly<Record<string, NudgeInfo>>,
  config: CompanyConfig,
  now: Date,
): Promise<Record<string, NudgeInfo>> {
  const next: Record<string, NudgeInfo> = {};
  for (const stopper of stoppers) {
    const old = previous[stopper.issueId];
    if (old) next[stopper.issueId] = old;
  }
  if (!config.act) return next;

  const holder = (id: string | null | undefined) => agents.find((agent) => agent.id === id)?.name ?? null;
  let sent = 0;

  for (const stopper of stoppers) {
    if (stopper.kind !== "waiting_agent" || stopper.wouldDo !== "wake_other_agent" || !stopper.issue || !stopper.targetAgentId) continue;
    const issueId = stopper.issueId;
    const targetId = stopper.targetAgentId;
    const targetName = stopper.targetAgentName ?? targetId;
    const old = previous[issueId];
    // Fresh outcome for this scan: an old skip or error must not linger.
    const record: NudgeInfo = {
      count: old?.count ?? 0,
      lastAt: old?.lastAt ?? "",
      targetAgentId: targetId,
      targetAgentName: targetName,
      ...(old?.lastRunId ? { lastRunId: old.lastRunId } : {}),
    };

    if (record.count >= MAX_NUDGES_PER_STOPPER) {
      next[issueId] = record;
      continue;
    }
    const last = Date.parse(record.lastAt);
    if (record.count > 0 && !Number.isNaN(last) && now.getTime() - last < NUDGE_SPACING_MS) {
      next[issueId] = record;
      continue;
    }
    if (sent >= MAX_NUDGES_PER_SCAN) {
      next[issueId] = { ...record, lastSkip: "scan_cap" };
      continue;
    }
    const target = agents.find((agent) => agent.id === targetId);
    if (!target || target.status !== "idle") {
      next[issueId] = { ...record, lastSkip: `not_idle:${target?.status ?? "missing"}` };
      continue;
    }

    const identifier = stopper.issue.identifier ?? stopper.issueId;
    let runId: string;
    try {
      const result = await ctx.agents.invoke(targetId, companyId, {
        prompt: buildPrompt({
          language: config.language,
          identifier,
          title: stopper.issue.title,
          holderName: holder(stopper.issue.assigneeAgentId),
          text: stopper.reason ?? "",
          quietMs: stopper.quietMs,
        }),
        reason: NUDGE_REASON,
      });
      runId = result.runId;
    } catch (error) {
      next[issueId] = { ...record, lastError: message(error) };
      continue;
    }

    sent += 1;
    const count = record.count + 1;
    next[issueId] = { ...record, count, lastAt: now.toISOString(), lastRunId: runId };
    try {
      await ctx.activity.log({
        companyId,
        entityType: "issue",
        entityId: issueId,
        message: buildActivityMessage(config.language, { identifier, targetName, count, max: MAX_NUDGES_PER_STOPPER }),
        metadata: { reason: NUDGE_REASON, targetAgentId: targetId, runId, nudge: count },
      });
    } catch (error) {
      // The wake already happened and counts; only the trail is missing.
      ctx.logger.warn("vigilante: activity entry failed after a wake", { companyId, issueId, error: message(error) });
    }
  }
  return next;
}
