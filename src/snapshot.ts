// Pure helpers to build the stored snapshot and keep `firstSeenAt` across scans.
import type { Stopper } from "./classify.js";
import type { CompanySnapshot, ScanError, Snapshot, StopperView } from "./shared.js";

/** `firstSeen[issueId]`: when the watcher first saw it stuck, and in which company. */
export type FirstSeen = Record<string, { at: string; companyId: string }>;

export interface CompanyScan {
  id: string;
  name: string;
  issuePrefix: string | null;
  /** `null` when the company could not be scanned. */
  stoppers: Stopper[] | null;
}

/**
 * Keeps the entry of every stopper still present, adds new ones with `nowIso`,
 * drops those that disappeared. Entries of companies that failed to scan are
 * kept untouched: a failed scan says nothing about them.
 */
export function mergeFirstSeen(
  previous: FirstSeen,
  current: Array<{ issueId: string; companyId: string }>,
  failedCompanyIds: ReadonlySet<string>,
  nowIso: string,
): FirstSeen {
  const next: FirstSeen = {};
  for (const [issueId, entry] of Object.entries(previous)) {
    if (failedCompanyIds.has(entry.companyId)) next[issueId] = entry;
  }
  for (const { issueId, companyId } of current) {
    next[issueId] = previous[issueId] ?? { at: nowIso, companyId };
  }
  return next;
}

export function toStopperView(stopper: Stopper, firstSeenAt: string): StopperView {
  return {
    issueId: stopper.issueId,
    identifier: stopper.issue?.identifier ?? null,
    title: stopper.issue?.title ?? null,
    status: stopper.issue?.status ?? null,
    kind: stopper.kind,
    wouldDo: stopper.wouldDo,
    stops: stopper.stops,
    quietMs: stopper.quietMs,
    reason: stopper.reason,
    firstSeenAt,
  };
}

export interface BuiltSnapshot {
  snapshot: Snapshot;
  firstSeen: FirstSeen;
}

export function buildSnapshot(
  scans: CompanyScan[],
  errors: ScanError[],
  previous: FirstSeen,
  scannedAt: Date,
  durationMs: number,
): BuiltSnapshot {
  const nowIso = scannedAt.toISOString();
  const failed = new Set(scans.filter((scan) => scan.stoppers === null).map((scan) => scan.id));
  for (const error of errors) if (error.companyId) failed.add(error.companyId);
  const current = scans.flatMap((scan) => (scan.stoppers ?? []).map((s) => ({ issueId: s.issueId, companyId: scan.id })));
  const firstSeen = mergeFirstSeen(previous, current, failed, nowIso);
  const companies: CompanySnapshot[] = scans.map((scan) => ({
    id: scan.id,
    name: scan.name,
    issuePrefix: scan.issuePrefix,
    stoppers: (scan.stoppers ?? []).map((s) => toStopperView(s, firstSeen[s.issueId]!.at)),
  }));
  return { snapshot: { scannedAt: nowIso, durationMs, companies, errors }, firstSeen };
}

/** Defensive read of what `ctx.state` returned. */
export function parseStored(value: unknown): { snapshot: Snapshot | null; firstSeen: FirstSeen } {
  if (!value || typeof value !== "object") return { snapshot: null, firstSeen: {} };
  const raw = value as { snapshot?: unknown; firstSeen?: unknown };
  const snapshot =
    raw.snapshot && typeof raw.snapshot === "object" && Array.isArray((raw.snapshot as Snapshot).companies)
      ? (raw.snapshot as Snapshot)
      : null;
  const firstSeen: FirstSeen = {};
  if (raw.firstSeen && typeof raw.firstSeen === "object") {
    for (const [id, entry] of Object.entries(raw.firstSeen as Record<string, unknown>)) {
      const e = entry as { at?: unknown; companyId?: unknown } | null;
      if (e && typeof e.at === "string" && typeof e.companyId === "string") firstSeen[id] = { at: e.at, companyId: e.companyId };
    }
  }
  return { snapshot, firstSeen };
}
