// The only action the plugin has: wake the agent another agent is waiting for.
// Limits are enforced from the stored record, which is WRITTEN BEFORE each wake
// (an attempt counts whether the invoke worked, threw or timed out), so they
// survive restarts, timeouts and failing writes.
import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { Stopper } from "./classify.js";
import type { AgentRef } from "./mentions.js";
import { buildPrompt, type PromptItem } from "./prompt.js";
import {
  MAX_NUDGES_PER_AGENT_DAY,
  MAX_NUDGES_PER_COMPANY_DAY,
  MAX_NUDGES_PER_SCAN,
  MAX_NUDGES_PER_STOPPER,
  NUDGE_AGENT_SPACING_MS,
  NUDGE_RECORD_TTL_MS,
  NUDGE_SPACING_MS,
  NUDGE_WINDOW_MS,
  type CompanyConfig,
  type NudgeInfo,
  type WakeLogEntry,
} from "./shared.js";

/** Stable reason string sent to the host with every wake. */
export const NUDGE_REASON = "vigilante_waiting_agent";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What the plugin remembers about its wakes. Replaced (never mutated) as the scan goes on. */
export interface WakeBook {
  nudges: Record<string, NudgeInfo>;
  wakeLog: WakeLogEntry[];
}

/**
 * Milliseconds since the record's last attempt; `null` when it has none.
 * A record with attempts and an unreadable time counts as "just now": it blocks.
 */
function sinceLast(record: NudgeInfo, nowMs: number): number | null {
  const last = Date.parse(record.lastAt);
  if (Number.isNaN(last)) return record.count > 0 ? 0 : null;
  return Math.max(0, nowMs - last);
}

/**
 * The records that survive this scan: those of issues still in the company's
 * open lists, unless 14 days passed since their last attempt. Records with no
 * attempt (only a skip note) are dropped once the issue is no longer a stopper.
 */
export function pruneNudges(
  previous: Readonly<Record<string, NudgeInfo>>,
  openIds: ReadonlySet<string>,
  stopperIds: ReadonlySet<string>,
  nowMs: number,
): Record<string, NudgeInfo> {
  const kept: Record<string, NudgeInfo> = {};
  for (const [issueId, record] of Object.entries(previous)) {
    if (!openIds.has(issueId)) continue;
    const age = sinceLast(record, nowMs);
    if (age !== null && age >= NUDGE_RECORD_TTL_MS) continue;
    if (record.count === 0 && !stopperIds.has(issueId)) continue;
    kept[issueId] = record;
  }
  return kept;
}

/** The log of the last 24 hours; an unreadable time is read as "now". */
export function pruneWakeLog(log: readonly WakeLogEntry[], nowMs: number): WakeLogEntry[] {
  const nowIso = new Date(nowMs).toISOString();
  return log
    .map((entry) => (Number.isNaN(Date.parse(entry.at)) ? { ...entry, at: nowIso } : entry))
    .filter((entry) => nowMs - Date.parse(entry.at) < NUDGE_WINDOW_MS);
}

export interface ActInput {
  companyId: string;
  stoppers: readonly Stopper[];
  agents: readonly AgentRef[];
  config: CompanyConfig;
  now: Date;
  /** Ids of every issue in the company's open lists of this scan. */
  openIds: ReadonlySet<string>;
  /** Writes the company record with the given wake book; rejects when the write fails. */
  persist: (book: WakeBook) => Promise<void>;
}

interface Pending {
  stopper: Stopper;
  record: NudgeInfo;
}

/**
 * Applies the retention rules, then (with `act` on) wakes each target agent at
 * most once with one combined message. `book` is updated as the scan goes on, so
 * a later failure of the scan still keeps every attempt. Never throws.
 */
export async function actOnStoppers(ctx: PluginContext, input: ActInput, book: WakeBook): Promise<void> {
  const { companyId, stoppers, agents, config, now, openIds, persist } = input;
  const nowMs = now.getTime();
  book.nudges = pruneNudges(book.nudges, openIds, new Set(stoppers.map((s) => s.issueId)), nowMs);
  book.wakeLog = pruneWakeLog(book.wakeLog, nowMs);
  if (!config.act) return;

  const holder = (id: string | null | undefined) => agents.find((agent) => agent.id === id)?.name ?? null;
  const setNote = (issueId: string, record: NudgeInfo, note: Partial<NudgeInfo>) => {
    book.nudges = { ...book.nudges, [issueId]: { ...record, ...note } };
  };

  // Actionable stoppers, grouped by target agent in the order the stoppers come.
  const groups = new Map<string, Pending[]>();
  for (const stopper of stoppers) {
    if (stopper.kind !== "waiting_agent" || stopper.wouldDo !== "wake_other_agent" || !stopper.issue || !stopper.targetAgentId) continue;
    const targetId = stopper.targetAgentId;
    const old = book.nudges[stopper.issueId];
    let record: NudgeInfo;
    if (old && old.targetAgentId === targetId) {
      record = { ...old };
      delete record.lastSkip;
    } else {
      // A new target starts a fresh record, but the spacing of the last attempt carries over.
      const carried = old ? (Number.isNaN(Date.parse(old.lastAt)) ? (old.count > 0 ? now.toISOString() : "") : old.lastAt) : "";
      record = { count: 0, lastAt: carried, targetAgentId: targetId, targetAgentName: stopper.targetAgentName ?? targetId };
    }
    book.nudges = { ...book.nudges, [stopper.issueId]: record };
    if (record.count >= MAX_NUDGES_PER_STOPPER) continue;
    const age = sinceLast(record, nowMs);
    if (age !== null && age < NUDGE_SPACING_MS) continue;
    const list = groups.get(targetId) ?? [];
    list.push({ stopper, record });
    groups.set(targetId, list);
  }

  let invokes = 0;
  for (const [targetId, pending] of groups) {
    const skip = (note: string) => {
      for (const { stopper, record } of pending) setNote(stopper.issueId, record, { lastSkip: note });
    };
    if (invokes >= MAX_NUDGES_PER_SCAN) {
      skip("scan_cap");
      continue;
    }
    const log = book.wakeLog;
    if (log.length >= MAX_NUDGES_PER_COMPANY_DAY) {
      skip("company_day");
      continue;
    }
    const mine = log.filter((entry) => entry.agentId === targetId);
    if (mine.some((entry) => nowMs - Date.parse(entry.at) < NUDGE_AGENT_SPACING_MS)) {
      skip("agent_gap");
      continue;
    }
    if (mine.length >= MAX_NUDGES_PER_AGENT_DAY) {
      skip("agent_day");
      continue;
    }
    const target = agents.find((agent) => agent.id === targetId);
    if (!target || target.status !== "idle") {
      skip(`not_idle:${target?.status ?? "missing"}`);
      continue;
    }

    // Write before waking: the attempt is stored first, and without it nothing is invoked.
    const nowIso = now.toISOString();
    const beforeNudges = book.nudges;
    const beforeLog = book.wakeLog;
    const attempted: Record<string, NudgeInfo> = { ...book.nudges };
    for (const { stopper, record } of pending) {
      const next: NudgeInfo = { ...record, count: record.count + 1, lastAt: nowIso, state: "attempted" };
      delete next.lastRunId;
      delete next.lastError;
      delete next.lastSkip;
      attempted[stopper.issueId] = next;
    }
    const withAttempt: WakeBook = { nudges: attempted, wakeLog: [...book.wakeLog, { at: nowIso, agentId: targetId }] };
    try {
      await persist(withAttempt);
    } catch (error) {
      ctx.logger.warn("vigilante: could not store the wake record; no agent is woken this scan", { companyId, error: message(error) });
      book.nudges = beforeNudges;
      book.wakeLog = beforeLog;
      return;
    }
    book.nudges = withAttempt.nudges;
    book.wakeLog = withAttempt.wakeLog;
    invokes += 1;

    const items: PromptItem[] = pending.map(({ stopper }) => ({
      identifier: stopper.issue!.identifier ?? stopper.issueId,
      title: stopper.issue!.title,
      holderName: holder(stopper.issue!.assigneeAgentId),
      text: stopper.reason ?? "",
      quietMs: stopper.quietMs,
    }));
    let outcome: Partial<NudgeInfo>;
    try {
      const result = await ctx.agents.invoke(targetId, companyId, { prompt: buildPrompt({ language: config.language, items }), reason: NUDGE_REASON });
      outcome = { state: "woken", lastRunId: result.runId };
    } catch (error) {
      outcome = { state: "failed", lastError: message(error) };
    }
    const settled = { ...book.nudges };
    for (const { stopper } of pending) settled[stopper.issueId] = { ...settled[stopper.issueId]!, ...outcome };
    book.nudges = settled;
    try {
      await persist(book);
    } catch (error) {
      // The attempt is already stored; only its outcome is missing from the record for now.
      ctx.logger.warn("vigilante: could not store the outcome of a wake", { companyId, error: message(error) });
    }
  }
}
