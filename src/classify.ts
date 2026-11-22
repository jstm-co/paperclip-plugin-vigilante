// Pure classification of "stopper" issues: the issue that a chain of blocked
// issues hangs from. No SDK calls here, so it is fully unit-testable.

export type StopperKind =
  | "waiting_person"
  | "backlog_unowned"
  | "backlog_assigned"
  | "waiting_third_party"
  | "gave_up"
  | "blocked_unexplained"
  | "open_no_run"
  | "other"
  | "unknown";

export type WouldDo = "none" | "wait" | "report" | "promote_to_todo" | "wake_assignee";

/** Minimal shape of an issue the classifier needs. Timestamps are ISO strings. */
export interface ScanIssue {
  id: string;
  identifier: string | null;
  title: string;
  status: string;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  updatedAt: string;
  /** Last activity including comments, when the host row has it. Preferred over `updatedAt`. */
  lastActivityAt?: string | null;
  blockerAttention?: {
    state?: string | null;
    reason?: string | null;
    unresolvedBlockerCount?: number | null;
    terminalBlockerIssueId?: string | null;
    directBlockerIssueId?: string | null;
  } | null;
  unblockDescriptor?: { action?: string | null } | null;
  activeRecoveryAction?: { kind?: string | null; status?: string | null } | null;
  activeRun?: unknown;
}

export interface ClassifyOptions {
  /** A stopper updated more recently than this is considered to be moving. Default 24. */
  quietHours?: number;
  /**
   * Open issues that are NOT `blocked` but still have unresolved blockers, as
   * `issueId -> blocker ids`. The host cancels every wake of such an issue
   * ("dependencies blocked") and reports no blocker attention for it, so the
   * scan reads its relations and passes them here.
   */
  heldBy?: ReadonlyMap<string, readonly string[]>;
}

export interface Stopper {
  issueId: string;
  /** `null` when the stopper is not in the list (kind `unknown`). */
  issue: ScanIssue | null;
  /** How many OTHER issues hang from this one. */
  stops: number;
  /** Milliseconds since the last activity (`lastActivityAt`, else `updatedAt`); `null` when unknown. */
  quietMs: number | null;
  kind: StopperKind;
  wouldDo: WouldDo;
  /** Explanation text when there is one (waiting_third_party). */
  reason: string | null;
  /**
   * The stopper moved less than `quietHours` ago. It is listed so a fresh jam is
   * visible, but it is too soon to act: `wouldDo` is `wait`.
   */
  recent: boolean;
}

export const DEFAULT_QUIET_HOURS = 24;
const HOUR_MS = 3_600_000;
const CLOSED = new Set(["done", "cancelled"]);
/** Open work that Paperclip's own sweep is expected to move. */
const OPEN_WORK = new Set(["todo", "in_progress", "in_review"]);
const INACTIVE_ACTION = new Set(["resolved", "completed", "cancelled", "canceled", "closed", "done", "dismissed", "expired"]);

function text(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

/** The recovery action's kind, when it is still active. */
function activeActionKind(issue: ScanIssue): string | null {
  const action = issue.activeRecoveryAction;
  if (!action) return null;
  const status = text(action.status)?.toLowerCase();
  if (status && INACTIVE_ACTION.has(status)) return null;
  return text(action.kind);
}

/** Id of the stopper a blocked issue points at (itself when it is the end of the chain). */
export function stopperIdOf(issue: ScanIssue): string | null {
  const attention = issue.blockerAttention;
  if (issue.status !== "blocked" || !attention || attention.state !== "needs_attention") return null;
  const terminal = attention.terminalBlockerIssueId;
  if ((attention.unresolvedBlockerCount ?? 0) > 0 && typeof terminal === "string" && terminal.length > 0 && terminal !== issue.id) {
    return terminal;
  }
  return issue.id;
}

/**
 * Follows the chain to its real end. The host's "terminal" blocker can itself be
 * a blocked issue that waits on another one (a plan created as a chain), so the
 * pointer is followed until it stops moving. A cycle ends at the first repeat.
 */
export function rootStopperId(issue: ScanIssue, byId: ReadonlyMap<string, ScanIssue>): string | null {
  let current = stopperIdOf(issue);
  if (current === null) return null;
  const seen = new Set<string>([issue.id]);
  while (!seen.has(current)) {
    seen.add(current);
    const next = byId.get(current);
    const nextTarget = next ? stopperIdOf(next) : null;
    if (nextTarget === null || nextTarget === current) break;
    current = nextTarget;
  }
  return current;
}

export function classifyIssue(issue: ScanIssue): { kind: StopperKind; wouldDo: WouldDo; reason: string | null } {
  const hasAgent = Boolean(issue.assigneeAgentId);
  const hasUser = Boolean(issue.assigneeUserId);
  if (hasUser && !hasAgent) return { kind: "waiting_person", wouldDo: "none", reason: null };
  if (issue.status === "backlog") {
    return hasAgent
      ? { kind: "backlog_assigned", wouldDo: "promote_to_todo", reason: null }
      : { kind: "backlog_unowned", wouldDo: "report", reason: null };
  }
  if (issue.status === "blocked") {
    const action = text(issue.unblockDescriptor?.action);
    const kind = activeActionKind(issue);
    if (action || kind === "deliberate_wait_without_target") {
      return { kind: "waiting_third_party", wouldDo: "report", reason: action ?? kind };
    }
    if (kind?.startsWith("stranded_")) return { kind: "gave_up", wouldDo: "wake_assignee", reason: kind };
    if (hasAgent && (issue.blockerAttention?.unresolvedBlockerCount ?? 0) === 0) {
      return { kind: "blocked_unexplained", wouldDo: "wake_assignee", reason: null };
    }
  }
  if (OPEN_WORK.has(issue.status)) return { kind: "open_no_run", wouldDo: "report", reason: null };
  return { kind: "other", wouldDo: "report", reason: null };
}

/** `now` is epoch milliseconds. */
export function classify(issues: ScanIssue[], now: number, options: ClassifyOptions = {}): Stopper[] {
  const quietMs = (options.quietHours ?? DEFAULT_QUIET_HOURS) * HOUR_MS;
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  const stops = new Map<string, number>();

  for (const issue of issues) {
    const target = rootStopperId(issue, byId);
    if (target === null) continue;
    stops.set(target, (stops.get(target) ?? 0) + (target === issue.id ? 0 : 1));
  }

  // Open issues held by their blockers: each blocker (or the end of its own chain) stops them.
  for (const [issueId, blockers] of options.heldBy ?? []) {
    const roots = new Set<string>();
    for (const blockerId of blockers) {
      const blocker = byId.get(blockerId);
      const root = (blocker && rootStopperId(blocker, byId)) ?? blockerId;
      if (root !== issueId) roots.add(root);
    }
    for (const root of roots) stops.set(root, (stops.get(root) ?? 0) + 1);
  }

  const result: Stopper[] = [];
  for (const [issueId, count] of stops) {
    const issue = byId.get(issueId) ?? null;
    if (!issue) {
      result.push({ issueId, issue: null, stops: count, quietMs: null, kind: "unknown", wouldDo: "report", reason: null, recent: false });
      continue;
    }
    if (CLOSED.has(issue.status) || issue.activeRun) continue;
    const updated = Date.parse(issue.lastActivityAt || issue.updatedAt);
    const quiet = Number.isNaN(updated) ? null : Math.max(0, now - updated);
    const verdict = classifyIssue(issue);
    const recent = quiet !== null && quiet < quietMs;
    // A person is already asked by Paperclip: that stays `none`, recent or not.
    const wouldDo = recent && verdict.wouldDo !== "none" ? "wait" : verdict.wouldDo;
    result.push({ issueId, issue, stops: count, quietMs: quiet, ...verdict, wouldDo, recent });
  }

  // Long-quiet ones first; then most stops, the longest quiet (unknown age sorts last), and id for stability.
  return result.sort(
    (a, b) => Number(a.recent) - Number(b.recent) || b.stops - a.stops || (b.quietMs ?? -1) - (a.quietMs ?? -1) || a.issueId.localeCompare(b.issueId),
  );
}
