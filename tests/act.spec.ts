import { describe, expect, it } from "vitest";
import { applyConfig, registerHandlers } from "../src/handlers.js";
import { scanCompany } from "../src/scan.js";
import { ACTION_SCAN_NOW, JOB_SCAN, type CompanyConfig, type CompanyState } from "../src/shared.js";
import { agent, fakeCtx, NOW, row, waitingRows, type FakeCompany } from "./fake-ctx.js";

const HOUR = 3_600_000;
const at = (hours: number) => new Date(NOW + hours * HOUR);
const ON: CompanyConfig = { enabled: true, act: true, actAfterMinutes: 30, language: "en" };
const TEXT = "Waiting for the Tech Lead: keep the attribution of X and hand the issue back";
const AGENTS = [agent("agent-1", "Backend Dev"), agent("agent-2", "Tech Lead"), agent("agent-3", "QA Engineer")];

function acme(over: Partial<FakeCompany> = {}): FakeCompany {
  return { id: "c-acme", name: "Acme", issuePrefix: "ACM", agents: AGENTS.map((a) => ({ ...a })), issues: waitingRows("s1", TEXT, 5), ...over };
}
const read = (store: Map<string, unknown>) => store.get("company/c-acme/scan") as CompanyState;
const scan = (t: ReturnType<typeof fakeCtx>, hours = 0, config: CompanyConfig = ON) => scanCompany(t.ctx, "c-acme", { now: at(hours), config });

describe("acting: waking the agent another agent waits for", () => {
  it("does not invoke when act is off, but still shows what it would do", async () => {
    const t = fakeCtx([acme()]);
    await scan(t, 0, { ...ON, act: false });
    expect(t.invokes).toEqual([]);
    expect(t.activities).toEqual([]);
    expect(read(t.store).company!.stoppers[0]).toMatchObject({ kind: "waiting_agent", wouldDo: "wake_other_agent", targetAgentName: "Tech Lead", nudge: null });
  });

  it("invokes once when act is on and the stopper is actionable, with prompt, reason and a trail", async () => {
    const t = fakeCtx([acme()]);
    await scan(t);
    expect(t.invokes).toHaveLength(1);
    expect(t.invokes[0]).toMatchObject({ agentId: "agent-2", companyId: "c-acme", reason: "vigilante_waiting_agent" });
    expect(t.invokes[0]!.prompt).toContain(TEXT);
    expect(t.invokes[0]!.prompt).toContain("Backend Dev");
    expect(t.activities).toHaveLength(1);
    expect(t.activities[0]).toMatchObject({ companyId: "c-acme", entityType: "issue", entityId: "s1" });
    expect(t.activities[0]!.message).toContain("Tech Lead");
    const view = read(t.store).company!.stoppers[0]!;
    expect(view.nudge).toMatchObject({ count: 1, lastAt: at(0).toISOString(), targetAgentId: "agent-2", targetAgentName: "Tech Lead", lastRunId: "run-1" });
    expect(read(t.store).nudges.s1!.count).toBe(1);
  });

  it("uses the configured language for the prompt", async () => {
    const t = fakeCtx([acme()]);
    await scan(t, 0, { ...ON, language: "es" });
    expect(t.invokes[0]!.prompt).toContain("Aviso automático");
  });

  it("does nothing before actAfterMinutes", async () => {
    const t = fakeCtx([acme({ issues: waitingRows("s1", TEXT, 20 / 60) })]);
    await scan(t);
    expect(t.invokes).toEqual([]);
    expect(read(t.store).company!.stoppers[0]).toMatchObject({ kind: "waiting_agent", wouldDo: "wait" });
    await scanCompany(t.ctx, "c-acme", { now: at(0), config: { ...ON, actAfterMinutes: 15 } });
    expect(t.invokes).toHaveLength(1);
  });

  it("spaces nudges 24 hours apart and stops after 3", async () => {
    const t = fakeCtx([acme()]);
    await scan(t, 0);
    await scan(t, 1);
    await scan(t, 23.9);
    expect(t.invokes).toHaveLength(1);
    await scan(t, 24);
    expect(t.invokes).toHaveLength(2);
    await scan(t, 48);
    expect(t.invokes).toHaveLength(3);
    await scan(t, 100);
    await scan(t, 400);
    expect(t.invokes).toHaveLength(3);
    expect(read(t.store).company!.stoppers[0]!.nudge).toMatchObject({ count: 3 });
  });

  it("caps nudges at 5 per company and scan, and the rest go on the next scan", async () => {
    const issues = [1, 2, 3, 4, 5, 6, 7].flatMap((n) => waitingRows(`s${n}`, TEXT, 5));
    const t = fakeCtx([acme({ issues })]);
    await scan(t, 0);
    expect(t.invokes).toHaveLength(5);
    expect(Object.values(read(t.store).nudges).filter((n) => n.lastSkip === "scan_cap")).toHaveLength(2);
    await scan(t, 1);
    expect(t.invokes).toHaveLength(7);
  });

  it("skips a target that is not idle, records why, does not count it and retries later", async () => {
    const company = acme();
    company.agents![1]!.status = "running";
    const t = fakeCtx([company]);
    await scan(t, 0);
    expect(t.invokes).toEqual([]);
    expect(read(t.store).nudges.s1).toMatchObject({ count: 0, lastSkip: "not_idle:running" });
    company.agents![1]!.status = "idle";
    await scan(t, 0.25);
    expect(t.invokes).toHaveLength(1);
    expect(read(t.store).nudges.s1).toMatchObject({ count: 1 });
    expect(read(t.store).nudges.s1!.lastSkip).toBeUndefined();
  });

  it("a failing invoke is recorded, not counted, and does not stop the other stoppers", async () => {
    const issues = [...waitingRows("s1", "Waiting for the QA Engineer", 5), ...waitingRows("s2", TEXT, 5)];
    const t = fakeCtx([acme({ issues, failInvoke: { "agent-3": "wakeup skipped" } })]);
    const out = await scan(t);
    expect(out.ok).toBe(true);
    expect(t.invokes.map((i) => i.agentId)).toEqual(["agent-2"]);
    expect(read(t.store).nudges.s1).toMatchObject({ count: 0, lastError: "wakeup skipped" });
    expect(read(t.store).nudges.s2).toMatchObject({ count: 1 });
    expect(read(t.store).company!.stoppers.find((s) => s.issueId === "s1")!.nudge).toMatchObject({ lastError: "wakeup skipped" });
  });

  it("an activity failure does not undo the nudge", async () => {
    const t = fakeCtx([acme({ failActivity: true })]);
    const out = await scan(t);
    expect(out.ok).toBe(true);
    expect(t.invokes).toHaveLength(1);
    expect(read(t.store).nudges.s1!.count).toBe(1);
    await scan(t, 1);
    expect(t.invokes).toHaveLength(1);
  });

  it("drops the nudge history when the issue stops being a stopper", async () => {
    const company = acme();
    const t = fakeCtx([company]);
    await scan(t);
    expect(Object.keys(read(t.store).nudges)).toEqual(["s1"]);
    company.issues = [row("other", { status: "todo" })];
    await scan(t, 1);
    expect(read(t.store).nudges).toEqual({});
    company.issues = waitingRows("s1", TEXT, 5);
    await scan(t, 2);
    expect(t.invokes).toHaveLength(2);
  });

  it("keeps a wake that happened even when the final write of the scan fails", async () => {
    const t = fakeCtx([acme()]);
    const set = t.ctx.state.set.bind(t.ctx.state);
    let first = true;
    t.ctx.state.set = async (scope, value) => {
      if (first) {
        first = false;
        throw new Error("state down");
      }
      return set(scope, value);
    };
    const out = await scan(t);
    expect(out.ok).toBe(false);
    expect(read(t.store).nudges.s1!.count).toBe(1);
    expect(t.invokes).toHaveLength(1);
  });

  it("a text naming two agents, or none, wakes nobody", async () => {
    for (const text of ["Waiting for Tech Lead and QA Engineer", "Waiting for the vendor"]) {
      const t = fakeCtx([acme({ issues: waitingRows("s1", text, 5) })]);
      await scan(t);
      expect(t.invokes).toEqual([]);
      expect(read(t.store).company!.stoppers[0]!.kind).toBe("waiting_third_party");
    }
  });

  it("a failing agents.list only loses the detection, it does not fail the scan", async () => {
    const t = fakeCtx([acme()]);
    t.ctx.agents.list = async () => {
      throw new Error("denied");
    };
    expect(await scan(t)).toMatchObject({ ok: true });
    expect(read(t.store).company!.stoppers[0]!.kind).toBe("waiting_third_party");
  });
});

describe("acting through the handlers", () => {
  function setup(companies: FakeCompany[], configs: Record<string, Record<string, unknown>>) {
    const fake = fakeCtx(companies);
    const map = new Map<string, CompanyConfig>();
    for (const [id, config] of Object.entries(configs)) applyConfig(map, config, id);
    registerHandlers(fake.ctx, map);
    return {
      ...fake,
      job: () => fake.handlers.jobs.get(JOB_SCAN)!({ jobKey: JOB_SCAN }),
      action: (p: Record<string, unknown>) => fake.handlers.actions.get(ACTION_SCAN_NOW)!(p),
    };
  }

  it("the job acts for an enabled company with act on, and never lists companies or fetches issue details", async () => {
    const t = setup([acme()], { "c-acme": { enabled: true, act: true } });
    await t.job();
    expect(t.invokes).toHaveLength(1);
    expect(t.calls).not.toContain("companies.list");
    expect(t.calls.some((c) => c.startsWith("issues.get"))).toBe(false);
    expect(t.calls.filter((c) => c.startsWith("agents.list"))).toEqual(["agents.list:c-acme"]);
  });

  it("the job does not act when act is off, or when the scan is not enabled", async () => {
    const t = setup([acme()], { "c-acme": { enabled: true, act: false } });
    await t.job();
    expect(t.invokes).toEqual([]);
    const u = setup([acme()], { "c-acme": { enabled: false, act: true } });
    await u.job();
    expect(u.invokes).toEqual([]);
    expect(u.calls).toEqual([]);
  });

  it("Scan now acts when act is on, without touching another company's record", async () => {
    const globex: FakeCompany = { id: "c-globex", name: "Globex", issuePrefix: "GLX", agents: AGENTS.map((a) => ({ ...a })), issues: waitingRows("g1", TEXT, 5) };
    const t = setup([acme(), globex], { "c-acme": { act: true }, "c-globex": { enabled: true, act: true } });
    await t.action({ companyId: "c-acme" });
    expect(t.invokes.map((i) => i.companyId)).toEqual(["c-acme"]);
    expect(t.store.get("company/c-globex/scan")).toBeUndefined();
    expect(t.calls.some((c) => c.includes("c-globex"))).toBe(false);
  });

  it("Scan now does not act with act off", async () => {
    const t = setup([acme()], { "c-acme": { enabled: true } });
    await t.action({ companyId: "c-acme" });
    expect(t.invokes).toEqual([]);
  });
});
