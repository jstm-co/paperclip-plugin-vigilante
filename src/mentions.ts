// Pure, deterministic detection of which agent an explanation text waits for.
// No AI: plain text matching on normalized strings. An agent only counts when its
// name comes right after a waiting phrase ("waiting for the Tech Lead").

export interface AgentRef {
  id: string;
  name: string;
  status: string;
}

export type MentionResult =
  | { kind: "one"; agent: AgentRef }
  | { kind: "none" }
  | { kind: "ambiguous" };

/** Lower case, accent-insensitive (NFD, marks removed), whitespace collapsed and trimmed. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Phrases that say "I am waiting for X". Matched accent- and case-insensitively,
 * and only when the agent name follows right after (see `findMentionedAgent`).
 * The last two English ones are weak ("need data from the vendor"), so the name
 * must then appear with its exact capitalization.
 */
export const WAITING_PHRASES: readonly string[] = [
  // English
  "waiting for", "waiting on", "waits for", "wait for", "blocked by", "blocked on", "pending on", "needs", "need",
  // Spanish
  "espera a", "espera al", "espera a la", "esperando a", "esperando al", "espero a", "espero al",
  "pendiente de", "pendiente del", "bloqueada por", "bloqueado por", "falta que", "depende de", "depende del",
  "necesita a", "necesita al",
];

/** Phrases whose agent name must match with its exact capitalization. */
export const CASE_SENSITIVE_PHRASES: readonly string[] = ["needs", "need"];

/** Words that, earlier in the same clause, cancel a waiting phrase ("not waiting on the CEO"). */
export const NEGATIONS: readonly string[] = ["not", "no longer", "no", "ya no", "sin", "never", "nunca"];

/** Articles and prepositions allowed between the phrase and the name. */
const CONNECTORS: readonly string[] = ["a", "al", "la", "el", "los", "las", "un", "una", "de", "del", "por", "con", "the", "an", "to", "on", "for", "by", "of", "from"];

/** Names of this many characters or fewer must match with their exact capitalization. */
export const SHORT_NAME_LENGTH = 3;

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const alternatives = (words: readonly string[]) => [...words].map(normalizeText).sort((a, b) => b.length - a.length).map((w) => escape(w).replace(/ /gu, "\\s+")).join("|");

const WAITING_BEFORE = new RegExp(
  `(?<![\\p{L}\\p{N}_])(?<phrase>${alternatives(WAITING_PHRASES)})(?:[\\s:]+(?:${alternatives(CONNECTORS)})(?![\\p{L}\\p{N}_]))*[\\s:]*$`,
  "u",
);
const NEGATION_BEFORE = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives(NEGATIONS)})(?![\\p{L}\\p{N}_])|n't(?![\\p{L}\\p{N}_])`, "u");
const CLAUSE_BREAK = /[.;!?,\n]/u;

/** Accent-insensitive and whitespace-collapsed, but capitalization kept. */
function normalizeCased(value: string): string {
  return value.normalize("NFD").replace(/\p{M}+/gu, "").replace(/\s+/gu, " ").trim();
}

/** Lower case that never changes the length of the string, so indexes of both versions agree. */
function lowerSameLength(value: string): string {
  return Array.from(value, (char) => {
    const lower = char.toLowerCase();
    return lower.length === char.length ? lower : char;
  }).join("");
}

const isWordChar = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}_]/u.test(char);

interface Hit {
  agent: AgentRef;
  start: number;
  end: number;
}

/** Every occurrence of `needle` in `haystack` that sits on word boundaries. */
function occurrences(haystack: string, needle: string): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    const end = at + needle.length;
    if (!isWordChar(haystack[at - 1]) && !isWordChar(haystack[end])) found.push([at, end]);
    from = at + 1;
  }
  return found;
}

/**
 * Whether the hit at `start` is introduced by a waiting phrase: the text before
 * it must end with a phrase from `WAITING_PHRASES`, with only articles,
 * prepositions, spaces or a colon in between, and no negation earlier in the
 * same clause.
 */
function isWaitedFor(lower: string, cased: string, hit: Hit, needleCased: string): boolean {
  const before = lower.slice(0, hit.start);
  const found = WAITING_BEFORE.exec(before);
  if (!found || found.groups?.phrase === undefined) return false;
  const clauseStart = Math.max(...[...before.slice(0, found.index)].map((char, i) => (CLAUSE_BREAK.test(char) ? i + 1 : 0)), 0);
  if (NEGATION_BEFORE.test(before.slice(clauseStart, found.index))) return false;
  const strong = CASE_SENSITIVE_PHRASES.map(normalizeText).includes(found.groups.phrase.replace(/\s+/gu, " "));
  return !strong || cased.slice(hit.start, hit.end) === needleCased;
}

/**
 * Finds the single agent, other than `ownerAgentId` (the issue's assignee), that
 * `text` says somebody is waiting for. Terminated agents are ignored. The name
 * must come right after a waiting phrase; names of `SHORT_NAME_LENGTH`
 * characters or fewer must match case-sensitively. When several names match, a
 * match lying strictly inside a longer different match's span is dropped (the
 * longest name wins). Another agent named anywhere else in the text makes the
 * result ambiguous, and so does a name that no waiting phrase introduces: that
 * is "none". The owner takes part in the containment step (so "Tech Lead Jr" is
 * not read as "Tech Lead") and is removed afterwards.
 */
export function findMentionedAgent(text: string, agents: readonly AgentRef[], ownerAgentId: string | null): MentionResult {
  const cased = normalizeCased(text);
  if (cased.length === 0) return { kind: "none" };
  const lower = lowerSameLength(cased);

  const hits: Hit[] = [];
  const needles = new Map<string, string>();
  for (const agent of agents) {
    if (agent.status === "terminated") continue;
    const needleCased = normalizeCased(agent.name);
    if (needleCased.length === 0) continue;
    needles.set(agent.id, needleCased);
    const short = needleCased.length <= SHORT_NAME_LENGTH;
    for (const [start, end] of occurrences(short ? cased : lower, short ? needleCased : lowerSameLength(needleCased))) hits.push({ agent, start, end });
  }

  const outer = hits.filter(
    (hit) =>
      !hits.some(
        (other) =>
          other.agent.id !== hit.agent.id &&
          other.start <= hit.start &&
          other.end >= hit.end &&
          other.end - other.start > hit.end - hit.start,
      ),
  );

  const named = outer.filter((hit) => hit.agent.id !== ownerAgentId);
  const ids = new Set(named.map((hit) => hit.agent.id));
  if (ids.size === 0) return { kind: "none" };
  if (ids.size > 1) return { kind: "ambiguous" };
  const [id] = ids;
  if (!named.some((hit) => isWaitedFor(lower, cased, hit, needles.get(id!)!))) return { kind: "none" };
  return { kind: "one", agent: agents.find((agent) => agent.id === id)! };
}
