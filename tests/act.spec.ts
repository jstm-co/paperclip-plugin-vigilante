import { describe, expect, it } from "vitest";
import { applyConfig, registerHandlers } from "../src/handlers.js";
import { scanCompany } from "../src/scan.js";
import {
  ACTION_SCAN_NOW,
  JOB_SCAN,
  MAX_NUDGES_PER_AGENT_DAY,
  MAX_NUDGES_PER_COMPANY_DAY,
  MAX_NUDGES_PER_SCAN,
  MAX_NUDGES_PER_STOPPER,
  NUDGE_AGENT_SPACING_MS,
  NUDGE_RECORD_TTL_MS,
  NUDGE_SPACING_MS,
  type CompanyConfig,
  type CompanyState,
} from "../src/shared.js";
import { agent, fakeCtx, NOW, row, waitingRows, type FakeCompany } from "./fake-ctx.js";

const HOUR = 3_600_000;
const at = (hours: number) => new Date(NOW + hours * HOUR);
const ON: CompanyConfig = { enabled: true, act: true, actAfterMinutes: 30, language: "en" };
const TEXT = "Waiting for the Tech Lead: keep the attribution of X and hand the issue back";
const AGENTS = [agent("agent-1", "Backend Dev"), agent("agent-2", "Tech Lead"), agent("agent-3", "QA Engineer")];

function acme(over: Partial<FakeCompany> = {}): FakeCompany {
  return { id: "c-acme", name: "Acme", issuePrefix: "ACM", agents: AGENTS.map((a) => ({ ...a })), issues: waitingRows("s1", TEXT, 5), ...over };
}
/** A company whose stoppers each wait (by structured owner) for their own target agent `t<n>`. */
function withTargets(count: number): FakeCompany {
  const targets = Array.from({ length: count }, (_, i) => agent(`t${i + 1}`, `Target ${i + 1}`));
  const issues = targets.flatMap((t, i) => waitingRows(`s${i + 1}`, "Please review", 5, { agentId: t.id }));
  return acme({ agents: [agent("agent-1", "Backend Dev"), ...targets], issues });
}
const read = (store: Map<string, unknown>) => store.get("company/c-acme/scan") as CompanyState;
const scan = (t: ReturnType<typeof fakeCtx>, hours = 0, config: CompanyConfig = ON) => scanCompany(t.ctx, "c-acme", { now: at(hours), config });
const woken = (t: ReturnType<typeof fakeCtx>) => t.invokes.map((i) => i.agentId);

describe("limits are exported", () => {
  it("has the documented values", () => {
    expect([NUDGE_SPACING_MS, MAX_NUDGES_PER_STOPPER, MAX_NUDGES_PER_SCAN, NUDGE_AGENT_SPACING_MS, MAX_NUDGES_PER_AGENT_DAY, MAX_NUDGES_PER_COMPANY_DAY, NUDGE_RECORD_TTL_MS]).toEqual([
      24 * HOUR, 3, 5, HOUR, 6, 20, 14 * 24 * HOUR,
    ]);
  });
});

describe("acting: waking the agent another agent waits for", () => {
  it("does not invoke when act is off, but still shows what it would do", async () => {
    const t = fakeCtx([acme()]);
    await scan(t, 0, { ...ON, act: false });
    expect(t.invokes).toEqual([]);
    expect(read(t.store).company!.stoppers[0]).toMatchObject({ kind: "waiting_agent", wouldDo: "wake_other_agent", targetAgentName: "Tech Lead", nudge: null });
  });

  it("invokes once when act is on and the stopper is actionable, with prompt and reason, and records it", async () => {
    const t = fakeCtx([acme()]);
    await scan(t);
    expect(t.invokes).toHaveLength(1);
    expect(t.invokes[0]).toMatchObject({ agentId: "agent-2", companyId: "c-acme", reason: "vigilante_waiting_agent" });
    expect(t.invokes[0]!.prompt).toContain(TEXT);
    expect(t.invokes[0]!.prompt).toContain("Backend Dev");
    expect(t.calls.some((c) => c.startsWith("activity"))).toBe(false);
    const view = read(t.store).company!.stoppers[0]!;
    expect(view.nudge).toMatchObject({ count: 1, lastAt: at(0).toISOString(), targetAgentId: "agent-2", targetAgentName: "Tech Lead", state: "woken", lastRunId: "run-1" });
    expect(read(t.store).wakeLog).toEqual([{ at: at(0).toISOString(), agentId: "agent-2" }]);
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

  it("spaces wakes 24 hours apart and stops after 3 for the life of the record", async () => {
    const t = fakeCtx([acme()]);
    await scan(t, 0);
    await scan(t, 1);
    await scan(t, 2);
    await scan(t, 23.9);
    expect(t.invokes).toHaveLength(1);
    await scan(t, 24);
    expect(t.invokes).toHaveLength(2);
    await scan(t, 48);
    expect(t.invokes).toHaveLength(3);
    await scan(t, 100);
    await scan(t, 300);
    expect(t.invokes).toHaveLength(3);
    expect(read(t.store).company!.stoppers[0]!.nudge).toMatchObject({ count: 3 });
  });

  it("a stopper that flaps (leaves the stopper list and comes back) does not restart its count", async () => {
    const company = acme();
    const t = fakeCtx([company]);
    const stopperRows = company.issues;
    const wakes: number[] = [];
    // Every 15 minutes for 4 days. After each wake the assignee runs for a scan (no stopper), then it re-blocks.
    let running = false;
    for (let step = 0; step < 4 * 96; step++) {
      const hours = step / 4;
      company.issues = stopperRows.map((r) => (r.id === "s1" ? { ...r, activeRun: running ? { id: "run" } : null } : r));
      const before = t.invokes.length;
      await scan(t, hours);
      if (t.invokes.length > before) wakes.push(hours);
      running = t.invokes.length > before;
    }
    expect(wakes).toEqual([0, 24, 48]);
    expect(t.invokes).toHaveLength(3);
  });

  it("drops the record when the issue leaves the open lists (closed), and starts a new one if it comes back", async () => {
    const company = acme();
    const t = fakeCtx([company]);
    await scan(t);
    expect(Object.keys(read(t.store).nudges)).toEqual(["s1"]);
    // Still open but no longer a stopper: the record stays.
    company.issues = [row("s1", { status: "todo" })];
    await scan(t, 1);
    expect(Object.keys(read(t.store).nudges)).toEqual(["s1"]);
    // Closed: gone from the open lists.
    company.issues = [row("other", { status: "todo" })];
    await scan(t, 2);
    expect(read(t.store).nudges).toEqual({});
    company.issues = waitingRows("s1", TEXT, 5);
    await scan(t, 3);
    expect(t.invokes).toHaveLength(2);
    expect(read(t.store).nudges.s1!.count).toBe(1);
  });

  it("drops the record 14 days after its last wake and then allows a new round", async () => {
    const t = fakeCtx([acme()]);
    for (const h of [0, 24, 48]) await scan(t, h);
    expect(t.invokes).toHaveLength(3);
    const expiry = 48 + NUDGE_RECORD_TTL_MS / HOUR;
    await scan(t, expiry - 1);
    expect(t.invokes).toHaveLength(3);
    expect(read(t.store).nudges.s1!.count).toBe(3);
    await scan(t, expiry);
    expect(t.invokes).toHaveLength(4);
    expect(read(t.store).nudges.s1!.count).toBe(1);
  });

  it("caps invokes at 5 per company and scan, and the rest go on the next scan", async () => {
    const t = fakeCtx([withTargets(7)]);
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
    expect(read(t.store).wakeLog).toEqual([]);
    company.agents![1]!.status = "idle";
    await scan(t, 0.25);
    expect(t.invokes).toHaveLength(1);
    expect(read(t.store).nudges.s1).toMatchObject({ count: 1 });
    expect(read(t.store).nudges.s1!.lastSkip).toBeUndefined();
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

describe("owner decides the target", () => {
  const run = async (issues: FakeCompany["issues"]) => {
    const t = fakeCtx([acme({ issues })]);
    await scan(t);
    return t;
  };

  it("the board or a user: nobody is woken, even if the text names an agent", async () => {
    for (const owner of ["board", { userId: "user-1" }]) {
      const t = await run(waitingRows("s1", TEXT, 5, owner));
      expect(t.invokes).toEqual([]);
      expect(read(t.store).company!.stoppers[0]).toMatchObject({ kind: "waiting_third_party" });
    }
  });

  it("another agent as owner is woken without matching any text", async () => {
    const t = await run(waitingRows("s1", "Please look at it", 5, { agentId: "agent-3" }));
    expect(woken(t)).toEqual(["agent-3"]);
  });

  it("the assignee as owner, or no owner, falls back to the text", async () => {
    expect(woken(await run(waitingRows("s1", TEXT, 5, { agentId: "agent-1" })))).toEqual(["agent-2"]);
    expect(woken(await run(waitingRows("s1", TEXT, 5, undefined)))).toEqual(["agent-2"]);
    expect(woken(await run(waitingRows("s1", "Waiting for the client", 5, { agentId: "agent-1" })))).toEqual([]);
  });
});

describe("write before waking", () => {
  it("stores the attempt before invoking", async () => {
    const t = fakeCtx([acme()]);
    let seen: CompanyState | undefined;
    const invoke = t.ctx.agents.invoke.bind(t.ctx.agents);
    t.ctx.agents.invoke = async (...args: Parameters<typeof invoke>) => {
      seen = structuredClone(read(t.store));
      return invoke(...args);
    };
    await scan(t);
    expect(seen!.nudges.s1).toMatchObject({ count: 1, state: "attempted", lastAt: at(0).toISOString() });
    expect(seen!.wakeLog).toHaveLength(1);
  });

  it("when the write fails nothing is invoked and the scan stops acting", async () => {
    const t = fakeCtx([withTargets(3)]);
    t.ctx.state.set = async () => {
      throw new Error("state down");
    };
    const out = await scan(t);
    expect(out.ok).toBe(false);
    expect(t.invokes).toEqual([]);
    expect(t.calls.filter((c) => c.startsWith("agents.invoke"))).toEqual([]);
  });

  it("with writes failing on every scan there are zero invokes, ever", async () => {
    const t = fakeCtx([acme()]);
    t.ctx.state.set = async () => {
      throw new Error("state down");
    };
    for (let i = 0; i < 20; i++) await scan(t, i * 0.25);
    expect(t.invokes).toEqual([]);
  });

  it("keeps the attempt when only the write after the invoke fails: no wake on the next scan", async () => {
    const t = fakeCtx([acme()]);
    const set = t.ctx.state.set.bind(t.ctx.state);
    let writes = 0;
    t.ctx.state.set = async (scope, value) => {
      writes += 1;
      if (writes >= 2) throw new Error("state down");
      return set(scope, value);
    };
    await scan(t);
    expect(t.invokes).toHaveLength(1);
    expect(read(t.store).nudges.s1).toMatchObject({ count: 1, state: "attempted" });
    t.ctx.state.set = set;
    await scan(t, 0.25);
    await scan(t, 1);
    expect(t.invokes).toHaveLength(1);
  });

  it("an invoke that throws counts like any other attempt, and does not stop the other targets", async () => {
    const issues = [...waitingRows("s1", "x", 5, { agentId: "agent-3" }), ...waitingRows("s2", TEXT, 5)];
    const t = fakeCtx([acme({ issues, failInvoke: { "agent-3": "wakeup skipped" } })]);
    const out = await scan(t);
    expect(out.ok).toBe(true);
    expect(woken(t)).toEqual(["agent-2"]);
    expect(read(t.store).nudges.s1).toMatchObject({ count: 1, state: "failed", lastError: "wakeup skipped" });
    expect(read(t.store).nudges.s2).toMatchObject({ count: 1, state: "woken" });
    expect(read(t.store).wakeLog.map((e) => e.agentId).sort()).toEqual(["agent-2", "agent-3"]);
    // Not retried on the next scans.
    await scan(t, 0.25);
    await scan(t, 5);
    expect(t.calls.filter((c) => c === "agents.invoke:agent-3")).toHaveLength(1);
  });

  it("a timeout (the host may have created the run) is counted: one call, not one every 15 minutes", async () => {
    const t = fakeCtx([acme()]);
    let hostCalls = 0;
    t.ctx.agents.invoke = async () => {
      hostCalls += 1;
      throw new Error('Worker→host call "agents.invoke" timed out after 30000ms');
    };
    for (let i = 0; i < 16; i++) await scan(t, i * 0.25);
    expect(hostCalls).toBe(1);
    expect(read(t.store).nudges.s1).toMatchObject({ count: 1, state: "failed" });
  });
});

describe("one wake per target and scan", () => {
  it("several stoppers naming the same agent: one invoke with a combined prompt, all recorded", async () => {
    const issues = [1, 2, 3].flatMap((n) => waitingRows(`s${n}`, `Waiting for the Tech Lead on part ${n}`, 5));
    const t = fakeCtx([acme({ issues })]);
    await scan(t);
    expect(t.invokes).toHaveLength(1);
    const prompt = t.invokes[0]!.prompt;
    for (const n of [1, 2, 3]) expect(prompt).toContain(`part ${n}`);
    for (const id of ["ACM-s1", "ACM-s2", "ACM-s3"]) expect(prompt).toContain(id);
    expect(prompt).toContain("3 blocked issues");
    for (const id of ["s1", "s2", "s3"]) expect(read(t.store).nudges[id]).toMatchObject({ count: 1, state: "woken", lastRunId: "run-1" });
    expect(read(t.store).wakeLog).toHaveLength(1);
    // None of them can be woken again within 24 hours.
    await scan(t, 5);
    expect(t.invokes).toHaveLength(1);
  });

  it("lists 5 issues and summarizes the rest, recording all of them", async () => {
    const issues = Array.from({ length: 8 }, (_, i) => waitingRows(`s${i + 1}`, TEXT, 5)).flat();
    const t = fakeCtx([acme({ issues })]);
    await scan(t);
    expect(t.invokes).toHaveLength(1);
    expect(t.invokes[0]!.prompt).toContain("and 3 more");
    expect(t.invokes[0]!.prompt.length).toBeLessThanOrEqual(1500);
    expect(Object.values(read(t.store).nudges).filter((n) => n.count === 1)).toHaveLength(8);
  });
});

describe("per-agent and per-company caps", () => {
  it("at most one wake per agent every 60 minutes", async () => {
    const company = acme();
    const t = fakeCtx([company]);
    await scan(t, 0);
    company.issues = [...company.issues, ...waitingRows("s2", TEXT, 5)];
    await scan(t, 0.25);
    await scan(t, 59 / 60);
    expect(t.invokes).toHaveLength(1);
    expect(read(t.store).nudges.s2).toMatchObject({ count: 0, lastSkip: "agent_gap" });
    await scan(t, 1);
    expect(t.invokes).toHaveLength(2);
    expect(read(t.store).nudges.s2).toMatchObject({ count: 1 });
  });

  it("at most 6 wakes per agent in a rolling 24 hours", async () => {
    const company = acme({ issues: [] });
    const t = fakeCtx([company]);
    for (let h = 0; h <= 6; h++) {
      company.issues = [...company.issues, ...waitingRows(`n${h}`, TEXT, 5)];
      await scan(t, h);
    }
    expect(t.invokes).toHaveLength(6);
    expect(read(t.store).nudges.n6).toMatchObject({ count: 0, lastSkip: "agent_day" });
    // The first wake leaves the window at hour 24.
    await scan(t, 23.5);
    expect(t.invokes).toHaveLength(6);
    await scan(t, 24);
    expect(t.invokes).toHaveLength(7);
  });

  it("at most 20 wakes per company in a rolling 24 hours", async () => {
    const t = fakeCtx([withTargets(25)]);
    for (let i = 0; i < 6; i++) await scan(t, i * 0.25);
    expect(t.invokes).toHaveLength(20);
    expect(Object.values(read(t.store).nudges).filter((n) => n.lastSkip === "company_day").length).toBe(5);
    await scan(t, 23.5);
    expect(t.invokes).toHaveLength(20);
    await scan(t, 24);
    expect(t.invokes.length).toBeGreaterThan(20);
  });
});

describe("defensive records", () => {
  const seed = (t: ReturnType<typeof fakeCtx>, state: Partial<CompanyState>) =>
    t.store.set("company/c-acme/scan", { company: null, firstSeen: {}, nudges: {}, wakeLog: [], errors: [], ...state });

  it("a record with attempts and an unreadable lastAt blocks like 'just now'", async () => {
    const t = fakeCtx([acme()]);
    seed(t, { nudges: { s1: { count: 1, lastAt: "not a date", targetAgentId: "agent-2", targetAgentName: "Tech Lead" } } });
    await scan(t, 0);
    await scan(t, 20);
    expect(t.invokes).toEqual([]);
  });

  it("an unreadable wake log entry counts as 'just now' for the caps", async () => {
    const t = fakeCtx([acme()]);
    seed(t, { wakeLog: [{ at: "garbage", agentId: "agent-2" }] });
    await scan(t, 0);
    expect(t.invokes).toEqual([]);
    expect(read(t.store).nudges.s1).toMatchObject({ lastSkip: "agent_gap" });
  });

  it("a changed target starts a fresh record, keeps the spacing, and the caps still apply", async () => {
    const company = acme();
    const t = fakeCtx([company]);
    await scan(t, 0);
    company.issues = waitingRows("s1", "Waiting for the QA Engineer", 5);
    await scan(t, 2);
    expect(woken(t)).toEqual(["agent-2"]);
    // Still shows the old wake only for the old target: here a fresh record with no wake of the new one.
    expect(read(t.store).nudges.s1).toMatchObject({ count: 0, targetAgentId: "agent-3", targetAgentName: "QA Engineer" });
    await scan(t, 24);
    expect(woken(t)).toEqual(["agent-2", "agent-3"]);
    expect(read(t.store).nudges.s1).toMatchObject({ count: 1, targetAgentName: "QA Engineer", state: "woken" });
    expect(read(t.store).company!.stoppers[0]!.nudge).toMatchObject({ count: 1, targetAgentName: "QA Engineer" });
  });

  it("a changed target is still limited by the per-agent cap of the new target", async () => {
    const company = acme();
    const t = fakeCtx([company]);
    seed(t, { wakeLog: [{ at: at(-0.5).toISOString(), agentId: "agent-3" }] });
    company.issues = waitingRows("s1", "Waiting for the QA Engineer", 5);
    await scan(t, 0);
    expect(t.invokes).toEqual([]);
    await scan(t, 0.5);
    expect(woken(t)).toEqual(["agent-3"]);
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

  it("Scan now never invokes, even with act on, but still reports what the job would do", async () => {
    const globex: FakeCompany = { id: "c-globex", name: "Globex", issuePrefix: "GLX", agents: AGENTS.map((a) => ({ ...a })), issues: waitingRows("g1", TEXT, 5) };
    const t = setup([acme(), globex], { "c-acme": { enabled: true, act: true }, "c-globex": { enabled: true, act: true } });
    await t.action({ companyId: "c-acme" });
    expect(t.invokes).toEqual([]);
    expect(read(t.store).company!.stoppers[0]).toMatchObject({ kind: "waiting_agent", wouldDo: "wake_other_agent", nudge: null });
    expect(t.store.get("company/c-globex/scan")).toBeUndefined();
    expect(t.calls.some((c) => c.includes("c-globex"))).toBe(false);
  });

  it("Scan now keeps the wake records the job wrote", async () => {
    const t = setup([acme()], { "c-acme": { enabled: true, act: true } });
    await t.job();
    await t.action({ companyId: "c-acme" });
    expect(read(t.store).nudges.s1).toMatchObject({ count: 1 });
    expect(read(t.store).wakeLog).toHaveLength(1);
    expect(read(t.store).company!.stoppers[0]!.nudge).toMatchObject({ count: 1 });
  });

  it("the job and Scan now running at the same time wake once", async () => {
    const t = setup([acme()], { "c-acme": { enabled: true, act: true } });
    await Promise.all([t.job(), t.action({ companyId: "c-acme" }), t.job()]);
    expect(t.invokes).toHaveLength(1);
  });
});
