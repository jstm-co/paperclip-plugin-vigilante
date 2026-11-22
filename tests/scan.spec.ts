import { describe, expect, it } from "vitest";
import { applyConfig, registerHandlers } from "../src/handlers.js";
import { runScan, scanCompany, stateScope, toScanIssue } from "../src/scan.js";
import { ACTION_SCAN_NOW, DATA_REPORT, JOB_SCAN, type CompanyConfig, type CompanyState, type Report } from "../src/shared.js";
import { blockedRow, fakeCtx, hoursAgo, NOW, row, type FakeCompany } from "./fake-ctx.js";

const NOW_DATE = new Date(NOW);

function acme(over: Partial<FakeCompany> = {}): FakeCompany {
  return {
    id: "c-acme", name: "Acme", issuePrefix: "ACM",
    issues: [blockedRow("b1", "s1"), blockedRow("b2", "s1"), row("s1", { status: "backlog" })],
    ...over,
  };
}
function globex(over: Partial<FakeCompany> = {}): FakeCompany {
  return {
    id: "c-globex", name: "Globex", issuePrefix: "GLX",
    issues: [blockedRow("g1", "t1"), row("t1", { status: "backlog", assigneeAgentId: "agent-2" })],
    ...over,
  };
}
const read = (store: Map<string, unknown>, id: string) => store.get(`company/${id}/scan`) as CompanyState | undefined;

describe("scanCompany", () => {
  it("finds the stopper from list rows alone, with one pass and no detail fetch", async () => {
    const { ctx, calls, store } = fakeCtx([acme()]);
    const out = await scanCompany(ctx, "c-acme", { now: NOW_DATE });
    expect(out).toEqual({ companyId: "c-acme", ok: true });
    const state = read(store, "c-acme")!;
    expect(state.company).toMatchObject({ name: "Acme", issuePrefix: "ACM" });
    expect(state.company!.stoppers).toMatchObject([{ issueId: "s1", stops: 2, kind: "backlog_unowned" }]);
    expect(calls.some((c) => c.startsWith("issues.get"))).toBe(false);
    expect(calls).not.toContain("companies.list");
  });

  it("a self-stopper (blocked, no blockers, agent) is kept, not replaced by a detail fetch", async () => {
    const self = row("x", {
      status: "blocked", assigneeAgentId: "agent-1",
      blockerAttention: { state: "needs_attention", unresolvedBlockerCount: 0, terminalBlockerIssueId: null },
    });
    const { ctx, store } = fakeCtx([acme({ issues: [self] })]);
    await scanCompany(ctx, "c-acme", { now: NOW_DATE });
    expect(read(store, "c-acme")!.company!.stoppers).toMatchObject([{ issueId: "x", kind: "blocked_unexplained", wouldDo: "wake_assignee" }]);
  });

  it("finds what holds a todo issue that is not blocked, reading relations only for open issues with an agent", async () => {
    const held = row("t", { status: "todo", assigneeAgentId: "a1", blockedByIds: ["b", "closed"] });
    const free = row("f", { status: "in_progress", assigneeAgentId: "a1" });
    const noAgent = row("n", { status: "todo", assigneeAgentId: null, blockedByIds: ["b"] });
    const issues = [held, free, noAgent, row("b", { status: "backlog", assigneeAgentId: "a1" }), row("closed", { status: "done" })];
    const { ctx, calls, store } = fakeCtx([acme({ issues })]);
    await scanCompany(ctx, "c-acme", { now: NOW_DATE });
    expect(calls.filter((c) => c.startsWith("issues.relations.get")).sort()).toEqual(["issues.relations.get:f", "issues.relations.get:t"]);
    expect(read(store, "c-acme")!.company!.stoppers).toMatchObject([{ issueId: "b", stops: 1, kind: "backlog_assigned" }]);
  });

  it("keeps the first-seen time across scans", async () => {
    const { ctx, store } = fakeCtx([acme()]);
    await scanCompany(ctx, "c-acme", { now: new Date(NOW - 3_600_000) });
    await scanCompany(ctx, "c-acme", { now: NOW_DATE });
    expect(read(store, "c-acme")!.company!.stoppers[0]!.firstSeenAt).toBe(new Date(NOW - 3_600_000).toISOString());
  });

  it("a failing company keeps its previous part and first-seen history, and records the error with its name", async () => {
    const company = acme();
    const { ctx, store } = fakeCtx([company]);
    await scanCompany(ctx, "c-acme", { now: new Date(NOW - 3_600_000) });
    const before = read(store, "c-acme")!;
    company.failList = "boom";
    const out = await scanCompany(ctx, "c-acme", { now: NOW_DATE });
    expect(out).toMatchObject({ ok: false, error: "boom" });
    const after = read(store, "c-acme")!;
    expect(after.company).toEqual(before.company);
    expect(after.firstSeen).toEqual(before.firstSeen);
    expect(after.errors).toEqual([{ companyId: "c-acme", companyName: "Acme", message: "boom" }]);
  });

  it("writes nothing when the old record cannot be read", async () => {
    const { ctx, store, calls } = fakeCtx([acme()]);
    ctx.state.get = async () => {
      throw new Error("state down");
    };
    const out = await scanCompany(ctx, "c-acme", { now: NOW_DATE });
    expect(out.ok).toBe(false);
    expect(store.size).toBe(0);
    expect(calls.some((c) => c.startsWith("state.set"))).toBe(false);
  });

  it("skips archived companies", async () => {
    const { ctx, store } = fakeCtx([acme({ status: "archived" })]);
    expect(await scanCompany(ctx, "c-acme", { now: NOW_DATE })).toMatchObject({ ok: true, skipped: true });
    expect(store.size).toBe(0);
  });
});

describe("runScan", () => {
  it("one company failing does not affect the others", async () => {
    const { ctx, store } = fakeCtx([acme({ failList: "boom" }), globex()]);
    const outcomes = await runScan(ctx, ["c-acme", "c-globex"], { now: NOW_DATE });
    expect(outcomes.map((o) => o.ok)).toEqual([false, true]);
    expect(read(store, "c-globex")!.company!.stoppers).toHaveLength(1);
    expect(read(store, "c-acme")!.company).toBeNull();
  });
});

describe("handlers", () => {
  function setup(companies: FakeCompany[], enabledIds: string[]) {
    const fake = fakeCtx(companies);
    const enabled = new Map<string, CompanyConfig>();
    for (const id of enabledIds) applyConfig(enabled, { enabled: true }, id);
    registerHandlers(fake.ctx, enabled);
    const job = () => fake.handlers.jobs.get(JOB_SCAN)!({ jobKey: JOB_SCAN });
    const action = (p: Record<string, unknown>) => fake.handlers.actions.get(ACTION_SCAN_NOW)!(p);
    const report = (p: Record<string, unknown>) => fake.handlers.data.get(DATA_REPORT)!(p) as Promise<Report>;
    return { ...fake, enabled, job, action, report };
  }

  it("the job scans only enabled companies and never lists companies or fetches issue details", async () => {
    const t = setup([acme(), globex()], ["c-acme"]);
    await t.job();
    expect(read(t.store, "c-acme")).toBeDefined();
    expect(read(t.store, "c-globex")).toBeUndefined();
    expect(t.calls).not.toContain("companies.list");
    expect(t.calls.some((c) => c.startsWith("issues.get"))).toBe(false);
    expect(t.calls.some((c) => c.includes("c-globex"))).toBe(false);
  });

  it("the job with no enabled company does nothing", async () => {
    const t = setup([acme()], []);
    await t.job();
    expect(t.calls).toEqual([]);
  });

  it("the job survives one company failing and still scans the next", async () => {
    const t = setup([acme({ failList: "boom" }), globex()], ["c-acme", "c-globex"]);
    await t.job();
    expect(read(t.store, "c-globex")!.company!.stoppers).toHaveLength(1);
    expect(read(t.store, "c-acme")!.errors[0]!.message).toBe("boom");
  });

  it("Scan now replaces only that company and keeps the others, even with its switch off", async () => {
    const t = setup([acme(), globex()], ["c-globex"]);
    await t.job();
    const globexBefore = read(t.store, "c-globex")!;
    expect(read(t.store, "c-acme")).toBeUndefined();

    await t.action({ companyId: "c-acme" });
    expect(read(t.store, "c-acme")!.company!.stoppers).toHaveLength(1);
    expect(read(t.store, "c-globex")).toEqual(globexBefore);
    expect(t.calls.filter((c) => c === "companies.list")).toEqual([]);
  });

  it("Scan now reports a failure to the caller", async () => {
    const t = setup([acme({ failList: "boom" })], []);
    await expect(t.action({ companyId: "c-acme" })).rejects.toThrow("boom");
    await expect(t.action({})).rejects.toThrow("companyId");
  });

  it("the report holds only the asked company, with its switch state", async () => {
    const t = setup([acme(), globex()], ["c-acme", "c-globex"]);
    await t.job();
    const r = await t.report({ companyId: "c-acme" });
    expect(r.enabled).toBe(true);
    expect(r.company!.id).toBe("c-acme");
    expect(JSON.stringify(r)).not.toContain("Globex");
    applyConfig(t.enabled, { enabled: false }, "c-acme");
    expect((await t.report({ companyId: "c-acme" })).enabled).toBe(false);
    expect(await t.report({ companyId: "c-unknown" })).toEqual({ enabled: false, act: false, company: null, errors: [] });
  });

  it("stateScope is company scoped", () => {
    expect(stateScope("c1")).toEqual({ scopeKind: "company", scopeId: "c1", stateKey: "scan" });
  });
});

describe("applyConfig", () => {
  it("keeps the config of every company, with invalid values falling back to defaults", () => {
    const map = new Map<string, CompanyConfig>();
    applyConfig(map, { enabled: true, act: true, actAfterMinutes: 45, language: "es" }, "c1");
    applyConfig(map, { enabled: true, act: "yes", actAfterMinutes: 5, language: "fr" }, "c2");
    applyConfig(map, { actAfterMinutes: 12.5 }, "c3");
    applyConfig(map, { enabled: true }, null);
    expect(map.get("c1")).toEqual({ enabled: true, act: true, actAfterMinutes: 45, language: "es" });
    expect(map.get("c2")).toEqual({ enabled: true, act: false, actAfterMinutes: 30, language: "en" });
    expect(map.get("c3")).toEqual({ enabled: false, act: false, actAfterMinutes: 30, language: "en" });
    expect(map.size).toBe(3);
  });
});

describe("toScanIssue", () => {
  it("reads lastActivityAt and activeRun defensively", () => {
    const issue = { id: "1", title: "t", status: "todo", updatedAt: new Date(hoursAgo(5)), lastActivityAt: new Date(hoursAgo(1)), activeRun: { id: "r" } };
    expect(toScanIssue(issue as never)).toMatchObject({ lastActivityAt: hoursAgo(1), activeRun: { id: "r" }, updatedAt: hoursAgo(5) });
    expect(toScanIssue({ id: "1", title: "t", status: "todo", updatedAt: new Date(hoursAgo(5)) } as never)).toMatchObject({ lastActivityAt: null, activeRun: null });
  });
});
