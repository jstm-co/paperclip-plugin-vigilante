// Pure helpers to build the per-company stored record and keep `firstSeenAt` across scans.
import type { Stopper } from "./classify.js";
import type { CompanySnapshot, CompanyState, ScanError, StopperView } from "./shared.js";

export const EMPTY_STATE: CompanyState = { company: null, firstSeen: {}, errors: [] };

/**
 * Keeps the entry of every issue still stuck, adds new ones with `nowIso` and
 * drops those that disappeared.
 */
export function mergeFirstSeen(previous: Record<string, string>, currentIds: readonly string[], nowIso: string): Record<string, string> {
  const next: Record<string, string> = {};
  for (const id of currentIds) next[id] = previous[id] ?? nowIso;
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
    recent: stopper.recent,
    firstSeenAt,
  };
}

export interface CompanyMeta {
  id: string;
  name: string;
  issuePrefix: string | null;
}

/** The record after a scan of the company finished well. */
export function buildState(meta: CompanyMeta, stoppers: Stopper[], previous: CompanyState, scannedAt: Date, durationMs: number): CompanyState {
  const nowIso = scannedAt.toISOString();
  const firstSeen = mergeFirstSeen(
    previous.firstSeen,
    stoppers.map((s) => s.issueId),
    nowIso,
  );
  const company: CompanySnapshot = {
    ...meta,
    scannedAt: nowIso,
    durationMs,
    stoppers: stoppers.map((s) => toStopperView(s, firstSeen[s.issueId]!)),
  };
  return { company, firstSeen, errors: [] };
}

/** The record after a failed scan: everything seen before is kept, only the errors change. */
export function failedState(previous: CompanyState, error: ScanError): CompanyState {
  return { company: previous.company, firstSeen: previous.firstSeen, errors: [error] };
}

function parseStopper(value: unknown): StopperView | null {
  if (!value || typeof value !== "object") return null;
  const s = value as Partial<StopperView>;
  if (typeof s.issueId !== "string" || typeof s.kind !== "string" || typeof s.firstSeenAt !== "string") return null;
  // Records written before `recent` existed only held long-quiet stoppers.
  return { ...(s as StopperView), recent: s.recent === true };
}

function parseError(value: unknown): ScanError | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Partial<ScanError>;
  if (typeof e.message !== "string") return null;
  return {
    companyId: typeof e.companyId === "string" ? e.companyId : null,
    companyName: typeof e.companyName === "string" ? e.companyName : null,
    message: e.message,
  };
}

/** Defensive read of what `ctx.state` returned: lists are always arrays. */
export function parseState(value: unknown): CompanyState {
  if (!value || typeof value !== "object") return { company: null, firstSeen: {}, errors: [] };
  const raw = value as { company?: unknown; firstSeen?: unknown; errors?: unknown };

  let company: CompanySnapshot | null = null;
  if (raw.company && typeof raw.company === "object") {
    const c = raw.company as Partial<CompanySnapshot>;
    if (typeof c.id === "string") {
      company = {
        id: c.id,
        name: typeof c.name === "string" ? c.name : c.id,
        issuePrefix: typeof c.issuePrefix === "string" ? c.issuePrefix : null,
        scannedAt: typeof c.scannedAt === "string" ? c.scannedAt : "",
        durationMs: typeof c.durationMs === "number" ? c.durationMs : 0,
        stoppers: Array.isArray(c.stoppers) ? c.stoppers.map(parseStopper).filter((s): s is StopperView => s !== null) : [],
      };
    }
  }

  const firstSeen: Record<string, string> = {};
  if (raw.firstSeen && typeof raw.firstSeen === "object" && !Array.isArray(raw.firstSeen)) {
    for (const [id, at] of Object.entries(raw.firstSeen as Record<string, unknown>)) if (typeof at === "string") firstSeen[id] = at;
  }

  const errors = Array.isArray(raw.errors) ? raw.errors.map(parseError).filter((e): e is ScanError => e !== null) : [];
  return { company, firstSeen, errors };
}
