import { describe, expect, it } from "vitest";
import { classify, classifyIssue, stopperIdOf, type ScanIssue } from "../src/classify.js";

const NOW = Date.parse("2026-03-10T12:00:00Z");
const HOUR = 3_600_000;
const ago = (hours: number) => new Date(NOW - hours * HOUR).toISOString();

function issue(id: string, over: Partial<ScanIssue> = {}): ScanIssue {
  return {
    id,
    identifier: `ACM-${id}`,
    title: `Task ${id}`,
    status: "todo",
    assigneeAgentId: null,
    assigneeUserId: null,
    updatedAt: ago(48),
    ...over,
  };
}

/** A blocked issue that needs attention and hangs from `terminal`. */
function blockedOn(id: string, terminal: string | null, over: Partial<ScanIssue> = {}): ScanIssue {
  return issue(id, {
    status: "blocked",
    assigneeAgentId: "agent-1",
    blockerAttention: {
      state: "needs_attention",
      unresolvedBlockerCount: terminal ? 1 : 0,
      terminalBlockerIssueId: terminal,
      directBlockerIssueId: terminal,
    },
    ...over,
  });
}

describe("stopperIdOf", () => {
  it("returns null for non-blocked issues and for blocked ones that do not need attention", () => {
    expect(stopperIdOf(issue("1"))).toBeNull();
    expect(stopperIdOf(blockedOn("2", "9", { blockerAttention: { state: "covered", terminalBlockerIssueId: "9", unresolvedBlockerCount: 1 } }))).toBeNull();
    expect(stopperIdOf(issue("3", { status: "blocked" }))).toBeNull();
  });

  it("points to the terminal blocker, or to itself", () => {
    expect(stopperIdOf(blockedOn("2", "9"))).toBe("9");
    expect(stopperIdOf(blockedOn("2", null))).toBe("2");
    expect(stopperIdOf(blockedOn("2", "2"))).toBe("2");
  });

  it("points to itself when the count is zero even if a terminal id is present", () => {
    const i = blockedOn("2", "9");
    i.blockerAttention!.unresolvedBlockerCount = 0;
    expect(stopperIdOf(i)).toBe("2");
  });
});

describe("classifyIssue kinds", () => {
  it("a: assigned to a person -> waiting_person / none", () => {
    expect(classifyIssue(issue("1", { assigneeUserId: "u1" }))).toMatchObject({ kind: "waiting_person", wouldDo: "none" });
    expect(classifyIssue(issue("1", { status: "backlog", assigneeUserId: "u1" })).kind).toBe("waiting_person");
  });

  it("a person plus an agent is not waiting_person", () => {
    expect(classifyIssue(issue("1", { status: "backlog", assigneeUserId: "u1", assigneeAgentId: "a1" })).kind).toBe("backlog_assigned");
  });

  it("b: backlog without assignee -> backlog_unowned / report", () => {
    expect(classifyIssue(issue("1", { status: "backlog" }))).toMatchObject({ kind: "backlog_unowned", wouldDo: "report" });
  });

  it("c: backlog with an agent -> backlog_assigned / promote_to_todo", () => {
    expect(classifyIssue(issue("1", { status: "backlog", assigneeAgentId: "a1" }))).toMatchObject({
      kind: "backlog_assigned",
      wouldDo: "promote_to_todo",
    });
  });

  it("d: blocked with an unblock action text -> waiting_third_party with the reason", () => {
    const r = classifyIssue(issue("1", { status: "blocked", assigneeAgentId: "a1", unblockDescriptor: { action: " Waiting for the vendor " } }));
    expect(r).toEqual({ kind: "waiting_third_party", wouldDo: "report", reason: "Waiting for the vendor" });
  });

  it("d: deliberate_wait_without_target also counts", () => {
    const r = classifyIssue(issue("1", { status: "blocked", assigneeAgentId: "a1", activeRecoveryAction: { kind: "deliberate_wait_without_target", status: "active" } }));
    expect(r).toMatchObject({ kind: "waiting_third_party", wouldDo: "report", reason: "deliberate_wait_without_target" });
  });

  it("e: stranded_* recovery action -> gave_up / wake_assignee", () => {
    const r = classifyIssue(issue("1", { status: "blocked", assigneeAgentId: "a1", activeRecoveryAction: { kind: "stranded_no_owner", status: "active" } }));
    expect(r).toMatchObject({ kind: "gave_up", wouldDo: "wake_assignee" });
  });

  it("a finished recovery action is ignored", () => {
    const r = classifyIssue(issue("1", { status: "blocked", assigneeAgentId: "a1", activeRecoveryAction: { kind: "stranded_x", status: "resolved" } }));
    expect(r.kind).toBe("blocked_unexplained");
  });

  it("d wins over e when both are present", () => {
    const r = classifyIssue(issue("1", { status: "blocked", assigneeAgentId: "a1", unblockDescriptor: { action: "wait" }, activeRecoveryAction: { kind: "stranded_x" } }));
    expect(r.kind).toBe("waiting_third_party");
  });

  it("f: blocked with an agent, no blockers, no explanation -> blocked_unexplained / wake_assignee", () => {
    expect(classifyIssue(blockedOn("1", null))).toMatchObject({ kind: "blocked_unexplained", wouldDo: "wake_assignee" });
  });

  it("g: blocked without agent and without explanation -> other", () => {
    expect(classifyIssue(blockedOn("1", null, { assigneeAgentId: null }))).toMatchObject({ kind: "other", wouldDo: "report" });
  });

  it("g: quiet todo / in_progress / in_review -> other / report", () => {
    for (const status of ["todo", "in_progress", "in_review"]) {
      expect(classifyIssue(issue("1", { status, assigneeAgentId: "a1" }))).toMatchObject({ kind: "other", wouldDo: "report" });
    }
  });
});

describe("classify", () => {
  it("returns nothing when no issue is blocked", () => {
    expect(classify([issue("1"), issue("2")], NOW)).toEqual([]);
  });

  it("groups a chain A -> B -> C that all point at terminal C", () => {
    const c = issue("C", { status: "todo", assigneeAgentId: "a1" });
    const issues = [blockedOn("A", "C"), blockedOn("B", "C"), c];
    const result = classify(issues, NOW);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ issueId: "C", stops: 2, kind: "other" });
    expect(result[0]!.quietMs).toBe(48 * HOUR);
  });

  it("does not report intermediate blocked issues as stoppers", () => {
    const issues = [blockedOn("A", "C"), blockedOn("B", "C"), issue("C", { status: "backlog" })];
    expect(classify(issues, NOW).map((s) => s.issueId)).toEqual(["C"]);
  });

  it("a blocked issue that is its own stopper is listed with zero stops", () => {
    const result = classify([blockedOn("A", null)], NOW);
    expect(result).toEqual([expect.objectContaining({ issueId: "A", stops: 0, kind: "blocked_unexplained" })]);
  });

  it("does not count the stopper itself in `stops`", () => {
    const result = classify([blockedOn("A", null), blockedOn("B", "A")], NOW);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ issueId: "A", stops: 1 });
  });

  it("a stopper may be in backlog", () => {
    const result = classify([blockedOn("A", "Z"), issue("Z", { status: "backlog" })], NOW);
    expect(result[0]).toMatchObject({ issueId: "Z", kind: "backlog_unowned", stops: 1 });
  });

  it("reports a missing stopper as unknown with just the id", () => {
    const result = classify([blockedOn("A", "gone"), blockedOn("B", "gone")], NOW);
    expect(result).toEqual([{ issueId: "gone", issue: null, stops: 2, quietMs: null, kind: "unknown", wouldDo: "report", reason: null }]);
  });

  it("ignores a stopper with an active run", () => {
    const result = classify([blockedOn("A", "C"), issue("C", { activeRun: { id: "run-1" } })], NOW);
    expect(result).toEqual([]);
  });

  it("ignores done and cancelled stoppers", () => {
    expect(classify([blockedOn("A", "C"), issue("C", { status: "done" })], NOW)).toEqual([]);
    expect(classify([blockedOn("A", "C"), issue("C", { status: "cancelled" })], NOW)).toEqual([]);
  });

  it("ignores a stopper updated less than quietHours ago (default 24)", () => {
    expect(classify([blockedOn("A", "C"), issue("C", { updatedAt: ago(23) })], NOW)).toEqual([]);
    expect(classify([blockedOn("A", "C"), issue("C", { updatedAt: ago(24) })], NOW)).toHaveLength(1);
  });

  it("honors a custom quietHours", () => {
    const issues = [blockedOn("A", "C"), issue("C", { updatedAt: ago(5) })];
    expect(classify(issues, NOW, { quietHours: 6 })).toEqual([]);
    expect(classify(issues, NOW, { quietHours: 4 })).toHaveLength(1);
  });

  it("an unparsable updatedAt does not hide the stopper", () => {
    const result = classify([blockedOn("A", "C"), issue("C", { updatedAt: "nope" })], NOW);
    expect(result[0]).toMatchObject({ issueId: "C", quietMs: null });
  });

  it("sorts by most stops, then oldest, then id", () => {
    const issues = [
      blockedOn("a1", "P"), blockedOn("a2", "P"),
      blockedOn("b1", "Q"),
      blockedOn("c1", "R"),
      issue("P", { updatedAt: ago(30) }),
      issue("Q", { updatedAt: ago(30) }),
      issue("R", { updatedAt: ago(100) }),
    ];
    expect(classify(issues, NOW).map((s) => s.issueId)).toEqual(["P", "R", "Q"]);
  });

  it("only issues in needs_attention count", () => {
    const calm = blockedOn("A", "C", { blockerAttention: { state: "covered", terminalBlockerIssueId: "C", unresolvedBlockerCount: 1 } });
    expect(classify([calm, issue("C")], NOW)).toEqual([]);
  });

  it("carries the reason of a waiting_third_party stopper", () => {
    const stopper = blockedOn("C", "D", { unblockDescriptor: { action: "Needs the invoice" }, blockerAttention: { state: "covered" } });
    const result = classify([blockedOn("A", "C"), stopper], NOW);
    expect(result[0]).toMatchObject({ issueId: "C", kind: "waiting_third_party", reason: "Needs the invoice" });
  });
});

describe("chains whose host terminal is itself blocked", () => {
  it("follows the pointer to the real end of the chain", () => {
    // 4 waits on 3, 3 on 2, 2 on the backlog issue 1; the host only reports the next hop.
    const issues = [
      issue("1", { status: "backlog" }),
      blockedOn("2", "1"),
      blockedOn("3", "2"),
      blockedOn("4", "3"),
    ];
    const result = classify(issues, NOW);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ issueId: "1", stops: 3, kind: "backlog_unowned" });
  });

  it("terminates on a cycle and reports each issue of the loop once", () => {
    const result = classify([blockedOn("1", "2"), blockedOn("2", "1")], NOW);
    expect(result.map((s) => s.issueId).sort()).toEqual(["1", "2"]);
  });

  it("keeps an unknown end when the chain leaves the list", () => {
    const result = classify([blockedOn("2", "9"), blockedOn("3", "2")], NOW);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ issueId: "9", stops: 2, kind: "unknown" });
  });
});
