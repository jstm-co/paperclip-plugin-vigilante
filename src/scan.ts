// The scan: reads every company's open issues and classifies the stoppers.
// It only calls read methods of the SDK. The pure parts live in classify.ts and snapshot.ts.
import type { Issue, PluginContext } from "@paperclipai/plugin-sdk";
import { classify, type ScanIssue } from "./classify.js";
import type { ScanError } from "./shared.js";
import { buildSnapshot, parseStored, type BuiltSnapshot, type CompanyScan } from "./snapshot.js";

/** Statuses the scan looks at. `ctx.issues.list` accepts one status per call. */
export const OPEN_STATUSES = ["backlog", "todo", "in_progress", "in_review", "blocked"] as const;
/** Upper bound of detail fetches per company, to keep a scan cheap. */
const MAX_DETAIL_FETCHES = 100;

function iso(value: Date | string | null | undefined): string {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * `activeRun` is not typed in this SDK's `Issue`; the host may still send it, so
 * it is read through a narrow local type.
 */
type MaybeActiveRun = { activeRun?: unknown };

export function toScanIssue(issue: Issue): ScanIssue {
  return {
    id: issue.id,
    identifier: issue.identifier ?? null,
    title: issue.title,
    status: issue.status,
    assigneeAgentId: issue.assigneeAgentId ?? null,
    assigneeUserId: issue.assigneeUserId ?? null,
    updatedAt: iso(issue.updatedAt),
    blockerAttention: issue.blockerAttention ?? null,
    unblockDescriptor: issue.unblockDescriptor ?? null,
    activeRecoveryAction: issue.activeRecoveryAction ?? null,
    activeRun: (issue as Issue & MaybeActiveRun).activeRun ?? null,
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

/** A list row may lack the fields the classifier needs; the detail has them. */
function lacksDetail(issue: Issue): boolean {
  return issue.unblockDescriptor === undefined || issue.activeRecoveryAction === undefined || !("activeRun" in issue);
}

async function scanCompany(ctx: PluginContext, companyId: string, quietHours: number | undefined, now: number): Promise<CompanyScan["stoppers"]> {
  const rows = await listOpenIssues(ctx, companyId);
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const issues = rows.map(toScanIssue);
  const first = classify(issues, now, { quietHours });

  // Fetch the detail of stoppers only, and only when the list row lacked a field.
  const enriched = new Map<string, ScanIssue>();
  let fetched = 0;
  for (const stopper of first) {
    const row = rowById.get(stopper.issueId);
    if (!row || !lacksDetail(row) || fetched >= MAX_DETAIL_FETCHES) continue;
    fetched += 1;
    const detail = await ctx.issues.get(stopper.issueId, companyId);
    if (detail) enriched.set(stopper.issueId, toScanIssue(detail));
  }
  if (enriched.size === 0) return first;
  return classify(
    issues.map((issue) => enriched.get(issue.id) ?? issue),
    now,
    { quietHours },
  );
}

export interface ScanInput {
  previous: unknown;
  now?: Date;
  quietHours?: number;
}

export async function runScan(ctx: PluginContext, input: ScanInput): Promise<BuiltSnapshot> {
  const started = Date.now();
  const scannedAt = input.now ?? new Date();
  const errors: ScanError[] = [];
  const scans: CompanyScan[] = [];

  let companies: Awaited<ReturnType<PluginContext["companies"]["list"]>> = [];
  try {
    companies = await ctx.companies.list();
  } catch (error) {
    errors.push({ companyId: null, message: error instanceof Error ? error.message : String(error) });
  }

  for (const company of companies) {
    if ((company as { status?: string }).status === "archived") continue;
    try {
      scans.push({
        id: company.id,
        name: company.name,
        issuePrefix: company.issuePrefix ?? null,
        stoppers: await scanCompany(ctx, company.id, input.quietHours, scannedAt.getTime()),
      });
    } catch (error) {
      errors.push({ companyId: company.id, message: error instanceof Error ? error.message : String(error) });
      scans.push({ id: company.id, name: company.name, issuePrefix: company.issuePrefix ?? null, stoppers: null });
    }
  }

  return buildSnapshot(scans, errors, parseStored(input.previous).firstSeen, scannedAt, Date.now() - started);
}
