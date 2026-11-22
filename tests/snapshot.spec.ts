import { describe, expect, it } from "vitest";
import type { Stopper } from "../src/classify.js";
import { buildState, failedState, mergeFirstSeen, parseState, toStopperView } from "../src/snapshot.js";

const T1 = "2026-03-10T10:00:00.000Z";
const T2 = "2026-03-10T10:15:00.000Z";
const META = { id: "c1", name: "Acme", issuePrefix: "ACM" };

function stopper(issueId: string, over: Partial<Stopper> = {}): Stopper {
  return {
    issueId,
    issue: { id: issueId, identifier: `ACM-${issueId}`, title: `Task ${issueId}`, status: "backlog", assigneeAgentId: null, assigneeUserId: null, updatedAt: T1 },
    stops: 2,
    quietMs: 1000,
    kind: "backlog_unowned",
    wouldDo: "report",
    reason: null,
    targetAgentId: null,
    targetAgentName: null,
    recent: false,
    ...over,
  };
}

describe("mergeFirstSeen", () => {
  it("adds new stoppers with the scan time", () => {
    expect(mergeFirstSeen({}, ["a"], T1)).toEqual({ a: T1 });
  });

  it("keeps the original time of one that is still stuck", () => {
    expect(mergeFirstSeen({ a: T1 }, ["a"], T2).a).toBe(T1);
  });

  it("drops entries that disappeared", () => {
    expect(Object.keys(mergeFirstSeen({ a: T1, b: T1 }, ["b"], T2))).toEqual(["b"]);
  });

  it("does not mutate the previous map", () => {
    const prev = { a: T1 };
    mergeFirstSeen(prev, [], T2);
    expect(prev).toEqual({ a: T1 });
  });
});

describe("toStopperView", () => {
  it("flattens the issue fields", () => {
    expect(toStopperView(stopper("a"), T1)).toMatchObject({ issueId: "a", identifier: "ACM-a", title: "Task a", status: "backlog", stops: 2, firstSeenAt: T1 });
  });

  it("handles a missing issue", () => {
    expect(toStopperView(stopper("gone", { issue: null, kind: "unknown", quietMs: null }), T1)).toMatchObject({
      issueId: "gone", identifier: null, title: null, status: null, kind: "unknown",
    });
  });
});

describe("buildState / failedState", () => {
  it("stamps firstSeenAt from the previous record and clears errors", () => {
    const prev = { company: null, firstSeen: { a: T1, z: T1 }, nudges: {}, wakeLog: [], errors: [{ companyId: "c1", message: "old" }] };
    const state = buildState(META, [stopper("a")], prev, new Date(T2), 42);
    expect(state.company).toMatchObject({ id: "c1", name: "Acme", scannedAt: T2, durationMs: 42 });
    expect(state.company!.stoppers[0]!.firstSeenAt).toBe(T1);
    expect(state.firstSeen).toEqual({ a: T1 });
    expect(state.errors).toEqual([]);
  });

  it("a failed scan keeps the company part and first-seen history", () => {
    const good = buildState(META, [stopper("a")], { company: null, firstSeen: {}, nudges: {}, wakeLog: [], errors: [] }, new Date(T1), 1);
    const failed = failedState(good, { companyId: "c1", companyName: "Acme", message: "boom" });
    expect(failed.company).toEqual(good.company);
    expect(failed.firstSeen).toEqual(good.firstSeen);
    expect(failed.errors).toEqual([{ companyId: "c1", companyName: "Acme", message: "boom" }]);
  });
});

describe("parseState", () => {
  it("returns an empty record for garbage, with arrays always present", () => {
    for (const bad of [null, undefined, "x", 3]) expect(parseState(bad)).toEqual({ company: null, firstSeen: {}, nudges: {}, wakeLog: [], errors: [] });
    const odd = parseState({ company: { id: "c" }, firstSeen: { a: 1, b: T1 }, errors: "nope" });
    expect(odd.errors).toEqual([]);
    expect(odd.company!.stoppers).toEqual([]);
    expect(odd.firstSeen).toEqual({ b: T1 });
  });

  it("round-trips a built record", () => {
    const state = buildState(META, [stopper("a")], { company: null, firstSeen: {}, nudges: {}, wakeLog: [], errors: [] }, new Date(T1), 1);
    expect(parseState(JSON.parse(JSON.stringify(state)))).toEqual({ ...state, errors: [] });
  });
});

describe("nudges in the record", () => {
  const nudge = { count: 2, lastAt: T1, targetAgentId: "ag", targetAgentName: "Tech Lead", lastRunId: "r1" };

  it("keeps every record it is given (they outlive the stopper) and shows the stopper's own", () => {
    const state = buildState(META, [stopper("a")], { company: null, firstSeen: {}, nudges: {}, wakeLog: [], errors: [] }, new Date(T2), 1, { a: nudge, gone: nudge }, [{ at: T1, agentId: "ag" }]);
    expect(Object.keys(state.nudges)).toEqual(["a", "gone"]);
    expect(state.wakeLog).toEqual([{ at: T1, agentId: "ag" }]);
    expect(state.company!.stoppers[0]!.nudge).toEqual(nudge);
  });

  it("a failed scan keeps the wake log", () => {
    const failed = failedState({ company: null, firstSeen: {}, nudges: { a: nudge }, wakeLog: [{ at: T1, agentId: "ag" }], errors: [] }, { companyId: "c1", message: "x" });
    expect(failed.wakeLog).toEqual([{ at: T1, agentId: "ag" }]);
    expect(failed.nudges).toEqual({ a: nudge });
  });

  it("reads the wake log and the nudge state defensively", () => {
    const parsed = parseState({ wakeLog: [{ at: T1, agentId: "ag" }, { agentId: "bad-time" }, 3, { at: T1 }], nudges: { a: { ...nudge, state: "failed" }, b: { ...nudge, state: "weird" } } });
    expect(parsed.wakeLog).toEqual([{ at: T1, agentId: "ag" }, { at: "", agentId: "bad-time" }]);
    expect(parsed.nudges.a!.state).toBe("failed");
    expect(parsed.nudges.b!.state).toBeUndefined();
    expect(parseState({ wakeLog: "x" }).wakeLog).toEqual([]);
  });

  it("round-trips and survives garbage", () => {
    const state = buildState(META, [stopper("a")], { company: null, firstSeen: {}, nudges: {}, wakeLog: [], errors: [] }, new Date(T2), 1, { a: nudge });
    expect(parseState(JSON.parse(JSON.stringify(state))).nudges).toEqual({ a: nudge });
    expect(parseState({ nudges: { x: 3, y: { targetAgentId: "q" } }, firstSeen: {} }).nudges).toEqual({});
  });
});

