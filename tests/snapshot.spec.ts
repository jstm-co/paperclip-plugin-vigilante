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
    const prev = { company: null, firstSeen: { a: T1, z: T1 }, errors: [{ companyId: "c1", message: "old" }] };
    const state = buildState(META, [stopper("a")], prev, new Date(T2), 42);
    expect(state.company).toMatchObject({ id: "c1", name: "Acme", scannedAt: T2, durationMs: 42 });
    expect(state.company!.stoppers[0]!.firstSeenAt).toBe(T1);
    expect(state.firstSeen).toEqual({ a: T1 });
    expect(state.errors).toEqual([]);
  });

  it("a failed scan keeps the company part and first-seen history", () => {
    const good = buildState(META, [stopper("a")], { company: null, firstSeen: {}, errors: [] }, new Date(T1), 1);
    const failed = failedState(good, { companyId: "c1", companyName: "Acme", message: "boom" });
    expect(failed.company).toEqual(good.company);
    expect(failed.firstSeen).toEqual(good.firstSeen);
    expect(failed.errors).toEqual([{ companyId: "c1", companyName: "Acme", message: "boom" }]);
  });
});

describe("parseState", () => {
  it("returns an empty record for garbage, with arrays always present", () => {
    for (const bad of [null, undefined, "x", 3]) expect(parseState(bad)).toEqual({ company: null, firstSeen: {}, errors: [] });
    const odd = parseState({ company: { id: "c" }, firstSeen: { a: 1, b: T1 }, errors: "nope" });
    expect(odd.errors).toEqual([]);
    expect(odd.company!.stoppers).toEqual([]);
    expect(odd.firstSeen).toEqual({ b: T1 });
  });

  it("round-trips a built record", () => {
    const state = buildState(META, [stopper("a")], { company: null, firstSeen: {}, errors: [] }, new Date(T1), 1);
    expect(parseState(JSON.parse(JSON.stringify(state)))).toEqual({ ...state, errors: [] });
  });
});
