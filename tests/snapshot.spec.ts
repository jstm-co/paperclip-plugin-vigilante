import { describe, expect, it } from "vitest";
import type { Stopper } from "../src/classify.js";
import { buildSnapshot, mergeFirstSeen, parseStored, toStopperView, type FirstSeen } from "../src/snapshot.js";

const T1 = "2026-03-10T10:00:00.000Z";
const T2 = "2026-03-10T10:15:00.000Z";
const NONE = new Set<string>();

function stopper(issueId: string, over: Partial<Stopper> = {}): Stopper {
  return {
    issueId,
    issue: { id: issueId, identifier: `ACM-${issueId}`, title: `Task ${issueId}`, status: "backlog", assigneeAgentId: null, assigneeUserId: null, updatedAt: T1 },
    stops: 2,
    quietMs: 1000,
    kind: "backlog_unowned",
    wouldDo: "report",
    reason: null,
    ...over,
  };
}

describe("mergeFirstSeen", () => {
  it("adds new stoppers with the scan time", () => {
    expect(mergeFirstSeen({}, [{ issueId: "a", companyId: "c1" }], NONE, T1)).toEqual({ a: { at: T1, companyId: "c1" } });
  });

  it("keeps the original time of one that is still stuck", () => {
    const prev: FirstSeen = { a: { at: T1, companyId: "c1" } };
    expect(mergeFirstSeen(prev, [{ issueId: "a", companyId: "c1" }], NONE, T2).a!.at).toBe(T1);
  });

  it("drops entries that disappeared", () => {
    const prev: FirstSeen = { a: { at: T1, companyId: "c1" }, b: { at: T1, companyId: "c1" } };
    expect(Object.keys(mergeFirstSeen(prev, [{ issueId: "b", companyId: "c1" }], NONE, T2))).toEqual(["b"]);
  });

  it("keeps entries of a company that failed to scan", () => {
    const prev: FirstSeen = { a: { at: T1, companyId: "c1" }, b: { at: T1, companyId: "c2" } };
    const next = mergeFirstSeen(prev, [], new Set(["c1"]), T2);
    expect(next).toEqual({ a: { at: T1, companyId: "c1" } });
  });

  it("does not mutate the previous map", () => {
    const prev: FirstSeen = { a: { at: T1, companyId: "c1" } };
    mergeFirstSeen(prev, [], NONE, T2);
    expect(prev).toEqual({ a: { at: T1, companyId: "c1" } });
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

describe("buildSnapshot", () => {
  const scans = [
    { id: "c1", name: "Acme", issuePrefix: "ACM", stoppers: [stopper("a")] },
    { id: "c2", name: "Globex", issuePrefix: "GLX", stoppers: null },
  ];

  it("builds companies, stamps firstSeenAt and records errors", () => {
    const prev: FirstSeen = { a: { at: T1, companyId: "c1" }, z: { at: T1, companyId: "c2" } };
    const errors = [{ companyId: "c2", message: "boom" }];
    const { snapshot, firstSeen } = buildSnapshot(scans, errors, prev, new Date(T2), 42);
    expect(snapshot.scannedAt).toBe(T2);
    expect(snapshot.durationMs).toBe(42);
    expect(snapshot.errors).toEqual(errors);
    expect(snapshot.companies[0]!.stoppers[0]!.firstSeenAt).toBe(T1);
    expect(snapshot.companies[1]!.stoppers).toEqual([]);
    expect(Object.keys(firstSeen).sort()).toEqual(["a", "z"]);
  });
});

describe("parseStored", () => {
  it("returns empty values for garbage", () => {
    expect(parseStored(null)).toEqual({ snapshot: null, firstSeen: {} });
    expect(parseStored("x")).toEqual({ snapshot: null, firstSeen: {} });
    expect(parseStored({ snapshot: 3, firstSeen: { a: 1, b: { at: T1, companyId: "c" } } })).toEqual({
      snapshot: null,
      firstSeen: { b: { at: T1, companyId: "c" } },
    });
  });

  it("round-trips a built snapshot", () => {
    const built = buildSnapshot([{ id: "c1", name: "Acme", issuePrefix: "ACM", stoppers: [stopper("a")] }], [], {}, new Date(T1), 1);
    expect(parseStored(JSON.parse(JSON.stringify(built)))).toEqual(built);
  });
});
