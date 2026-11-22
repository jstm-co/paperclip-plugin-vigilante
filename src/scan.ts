// The scan: reads one company's open issues and classifies its stoppers.
// It only calls read methods of the SDK (plus the plugin's own state). The pure
// parts live in classify.ts and snapshot.ts. Every company is scanned on its own:
// its record is read, rebuilt and written alone, so one company can neither
// lose another one's data nor its own history because of a failure.
import type { Issue, PluginContext } from "@paperclipai/plugin-sdk";
import { classify, type ScanIssue } from "./classify.js";
import { STATE_KEY, type CompanyState } from "./shared.js";
import { buildState, failedState, parseState, type CompanyMeta } from "./snapshot.js";

/** Statuses the scan looks at. `ctx.issues.list` accepts one status per call. */
export const OPEN_STATUSES = ["blocked", "backlog", "todo", "in_progress", "in_review"] as const;

export const stateScope = (companyId: string) => ({ scopeKind: "company", scopeId: companyId, stateKey: STATE_KEY }) as const;

function iso(value: Date | string | null | undefined): string {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * `activeRun` and `lastActivityAt` may be missing from this SDK's `Issue` type
 * or from a row; they are read through a narrow local type.
 */
type MaybeExtras = { activeRun?: unknown; lastActivityAt?: Date | string | null };

/** List rows carry `blockerAttention`, `unblockDescriptor` and `activeRun`. */
export function toScanIssue(issue: Issue): ScanIssue {
  const extras = issue as Issue & MaybeExtras;
  return {
    id: issue.id,
    identifier: issue.identifier ?? null,
    title: issue.title,
    status: issue.status,
    assigneeAgentId: issue.assigneeAgentId ?? null,
    assigneeUserId: issue.assigneeUserId ?? null,
    updatedAt: iso(issue.updatedAt),
    lastActivityAt: iso(extras.lastActivityAt) || null,
    blockerAttention: issue.blockerAttention ?? null,
    unblockDescriptor: issue.unblockDescriptor ?? null,
    // Not delivered to plugins by the host today; kept so it works if it ever is.
    activeRecoveryAction: issue.activeRecoveryAction ?? null,
    activeRun: extras.activeRun ?? null,
  };
}

/** Lists the open issues of a company, one call per status, deduplicated by id. */
async function listOpenIssues(ctx: PluginContext, companyId: string): Promise<Issue[]> {
  const byId = new Map<string, Issue>();
  for (const status of OPEN_STATUSES) {
    // No limit/offset: the host applies the window twice and offset > 0 returns wrong rows.
    for (const issue of await ctx.issues.list({ companyId, status })) byId.set(issue.id, issue);
  }
  return [...byId.values()];
}

export interface ScanOptions {
  now?: Date;
  quietHours?: number;
}

export interface CompanyOutcome {
  companyId: string;
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

/** Upper bound of relation reads per company and scan, to keep a scan cheap. */
export const MAX_RELATION_READS = 50;
const HELD_STATUSES = new Set(["todo", "in_progress"]);
const RESOLVED = new Set(["done", "cancelled"]);

/**
 * Open issues with an agent and no run may be held by unresolved blockers: the
 * host cancels their wakes ("dependencies blocked") but, as they are not
 * `blocked`, their list row reports no blocker attention. Their relations say
 * what holds them. One read per candidate, capped.
 */
async function readHeldBy(ctx: PluginContext, companyId: string, issues: ScanIssue[]): Promise<Map<string, string[]>> {
  const heldBy = new Map<string, string[]>();
  const candidates = issues.filter((issue) => HELD_STATUSES.has(issue.status) && issue.assigneeAgentId && !issue.activeRun);
  for (const issue of candidates.slice(0, MAX_RELATION_READS)) {
    const relations = await ctx.issues.relations.get(issue.id, companyId);
    const open = (relations?.blockedBy ?? []).filter((blocker) => !RESOLVED.has(blocker.status)).map((blocker) => blocker.id);
    if (open.length > 0) heldBy.set(issue.id, open);
  }
  return heldBy;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Name and prefix for the page. `companies.get` works in the job's scope for an enabled company. */
async function companyMeta(ctx: PluginContext, companyId: string, previous: CompanyState): Promise<CompanyMeta & { archived: boolean }> {
  const fallback = { id: companyId, name: previous.company?.name ?? companyId, issuePrefix: previous.company?.issuePrefix ?? null };
  try {
    const company = await ctx.companies.get(companyId);
    if (!company) return { ...fallback, archived: false };
    return {
      id: companyId,
      name: company.name || fallback.name,
      issuePrefix: company.issuePrefix ?? fallback.issuePrefix,
      archived: (company as { status?: string }).status === "archived",
    };
  } catch {
    return { ...fallback, archived: false };
  }
}

/**
 * Scans one company and writes its record. Never throws: a failure is stored as
 * an error on the company's record and everything seen before is kept.
 */
export async function scanCompany(ctx: PluginContext, companyId: string, options: ScanOptions = {}): Promise<CompanyOutcome> {
  const started = Date.now();
  const scannedAt = options.now ?? new Date();
  let previous: CompanyState;
  try {
    previous = parseState(await ctx.state.get(stateScope(companyId)));
  } catch (error) {
    // Cannot read the old record: writing now could erase its history. Do nothing.
    return { companyId, ok: false, error: message(error) };
  }

  const meta = await companyMeta(ctx, companyId, previous);
  if (meta.archived) return { companyId, ok: true, skipped: true };

  try {
    const issues = (await listOpenIssues(ctx, companyId)).map(toScanIssue);
    const heldBy = await readHeldBy(ctx, companyId, issues);
    const stoppers = classify(issues, scannedAt.getTime(), { quietHours: options.quietHours, heldBy });
    const next = buildState({ id: meta.id, name: meta.name, issuePrefix: meta.issuePrefix }, stoppers, previous, scannedAt, Date.now() - started);
    await ctx.state.set(stateScope(companyId), next);
    return { companyId, ok: true };
  } catch (error) {
    const text = message(error);
    try {
      await ctx.state.set(stateScope(companyId), failedState(previous, { companyId, companyName: meta.name, message: text }));
    } catch {
      // The failure itself could not be stored; the previous record stays as it was.
    }
    return { companyId, ok: false, error: text };
  }
}

/** Scans the given companies one after the other. A failing one does not stop the rest. */
export async function runScan(ctx: PluginContext, companyIds: Iterable<string>, options: ScanOptions = {}): Promise<CompanyOutcome[]> {
  const outcomes: CompanyOutcome[] = [];
  for (const companyId of companyIds) outcomes.push(await scanCompany(ctx, companyId, options));
  return outcomes;
}
