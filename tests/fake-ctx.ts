// A fake plugin context shaped like the host: list rows carry blockerAttention/activeRun,
// `issues.get` and `companies.list` exist only to prove the plugin never calls them.
import type { PluginContext } from "@paperclipai/plugin-sdk";

export interface FakeCompany {
  id: string;
  name: string;
  issuePrefix: string;
  status?: string;
  issues: Array<Record<string, unknown>>;
  /** Make every `issues.list` call of this company fail. */
  failList?: string;
}

export function fakeCtx(companies: FakeCompany[]) {
  const calls: string[] = [];
  const store = new Map<string, unknown>();
  const handlers = { jobs: new Map<string, (job: unknown) => Promise<void>>(), actions: new Map<string, (p: Record<string, unknown>) => Promise<unknown>>(), data: new Map<string, (p: Record<string, unknown>) => Promise<unknown>>() };
  const keyOf = (scope: { scopeKind: string; scopeId?: string; stateKey: string }) => `${scope.scopeKind}/${scope.scopeId ?? ""}/${scope.stateKey}`;
  const find = (id: string) => companies.find((c) => c.id === id);

  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    companies: {
      async list() {
        calls.push("companies.list");
        throw new Error("company context is required");
      },
      async get(id: string) {
        calls.push(`companies.get:${id}`);
        const c = find(id);
        return c ? { id: c.id, name: c.name, issuePrefix: c.issuePrefix, status: c.status ?? "active" } : null;
      },
    },
    issues: {
      async list(input: { companyId: string; status?: string }) {
        calls.push(`issues.list:${input.companyId}:${input.status}`);
        const c = find(input.companyId);
        if (!c) throw new Error("unknown company");
        if (c.failList) throw new Error(c.failList);
        return c.issues.filter((i) => i.status === input.status);
      },
      async get(id: string) {
        calls.push(`issues.get:${id}`);
        throw new Error("issues.get must not be called");
      },
    },
    state: {
      async get(scope: { scopeKind: string; scopeId?: string; stateKey: string }) {
        calls.push(`state.get:${scope.scopeId ?? ""}`);
        return store.get(keyOf(scope)) ?? null;
      },
      async set(scope: { scopeKind: string; scopeId?: string; stateKey: string }, value: unknown) {
        calls.push(`state.set:${scope.scopeId ?? ""}`);
        store.set(keyOf(scope), JSON.parse(JSON.stringify(value)));
      },
      async delete(scope: { scopeKind: string; scopeId?: string; stateKey: string }) {
        store.delete(keyOf(scope));
      },
    },
    jobs: { register: (key: string, fn: (job: unknown) => Promise<void>) => void handlers.jobs.set(key, fn) },
    actions: { register: (key: string, fn: (p: Record<string, unknown>) => Promise<unknown>) => void handlers.actions.set(key, fn) },
    data: { register: (key: string, fn: (p: Record<string, unknown>) => Promise<unknown>) => void handlers.data.set(key, fn) },
  };
  return { ctx: ctx as unknown as PluginContext, calls, store, handlers };
}

const NOW = Date.parse("2026-03-10T12:00:00Z");
export const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
export { NOW };

export function row(id: string, over: Record<string, unknown> = {}) {
  return { id, identifier: `ACM-${id}`, title: `Task ${id}`, status: "todo", assigneeAgentId: null, assigneeUserId: null, updatedAt: hoursAgo(48), ...over };
}

/** A blocked row that needs attention and hangs from `terminal`. */
export function blockedRow(id: string, terminal: string, over: Record<string, unknown> = {}) {
  return row(id, {
    status: "blocked",
    assigneeAgentId: "agent-1",
    blockerAttention: { state: "needs_attention", unresolvedBlockerCount: 1, terminalBlockerIssueId: terminal, directBlockerIssueId: terminal },
    ...over,
  });
}
