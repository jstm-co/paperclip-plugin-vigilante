// Pure text for the wake-up: the one prompt a woken agent receives, listing
// every issue that waits for it (the host merges concurrent wakes into one run
// and keeps only the last message, so there is exactly one message per agent).
import { formatDuration, type Locale } from "./i18n.js";

export interface PromptItem {
  /** Issue identifier, or its id when it has none. */
  identifier: string;
  title: string;
  /** Name of the agent holding the issue; `null` when it is not held by an agent. */
  holderName: string | null;
  /** The explanation text, verbatim (truncated when long). */
  text: string;
  quietMs: number | null;
}

export interface PromptInput {
  language: Locale;
  items: readonly PromptItem[];
}

export const MAX_PROMPT_CHARS = 1500;
/** Issues listed in one message; the rest are summarized as "and N more". */
export const MAX_PROMPT_ITEMS = 5;
const MAX_TEXT = 200;
const MIN_TEXT = 30;
const MAX_TITLE = 60;
const MAX_NAME = 30;
const MAX_ID = 24;

function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/gu, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

interface Copy {
  intro: (n: number) => string;
  item: (v: { n: number; id: string; title: string; holder: string; quiet: string; text: string }) => string;
  more: (n: number) => string;
  outro: (n: number) => string;
  nobody: string;
  unknownTime: string;
}

const COPY: Record<Locale, Copy> = {
  en: {
    intro: (n) =>
      `Automatic notice from the Vigilante plugin (no AI involved). ${n === 1 ? "A blocked issue is" : `${n} blocked issues are`} waiting for you:`,
    item: (v) => `${v.n}. ${v.id} "${v.title}", held by ${v.holder}, quiet for ${v.quiet}. Its explanation says: "${v.text}"`,
    more: (n) => `...and ${n} more.`,
    outro: (n) => `What is expected: open ${n === 1 ? "that issue" : "each issue"} and do what it asks, or comment on it if it is not yours to do.`,
    nobody: "no agent",
    unknownTime: "an unknown time",
  },
  es: {
    intro: (n) =>
      `Aviso automático del plugin Vigilante (sin IA). ${n === 1 ? "Una tarea bloqueada te está esperando" : `${n} tareas bloqueadas te están esperando`}:`,
    item: (v) => `${v.n}. ${v.id} "${v.title}", la tiene ${v.holder}, lleva ${v.quiet} sin movimiento. Su explicación dice: "${v.text}"`,
    more: (n) => `...y ${n} más.`,
    outro: (n) => `Lo que se espera: abre ${n === 1 ? "esa tarea" : "cada tarea"} y haz lo que pide, o comenta en ella si no te corresponde.`,
    nobody: "ningún agente",
    unknownTime: "un tiempo desconocido",
  },
};

function render(input: PromptInput, textMax: number): string {
  const copy = COPY[input.language];
  const listed = input.items.slice(0, MAX_PROMPT_ITEMS);
  const lines = [copy.intro(input.items.length)];
  listed.forEach((item, index) =>
    lines.push(
      copy.item({
        n: index + 1,
        id: clip(item.identifier, MAX_ID),
        title: clip(item.title, MAX_TITLE),
        holder: item.holderName ? clip(item.holderName, MAX_NAME) : copy.nobody,
        quiet: item.quietMs === null ? copy.unknownTime : formatDuration(input.language, item.quietMs),
        text: clip(item.text, textMax),
      }),
    ),
  );
  if (input.items.length > listed.length) lines.push(copy.more(input.items.length - listed.length));
  lines.push(copy.outro(input.items.length));
  return lines.join("\n");
}

/** One plain-text message for one agent, at most `MAX_PROMPT_CHARS` characters. */
export function buildPrompt(input: PromptInput): string {
  // Shrink the per-issue text until the whole message fits.
  for (let textMax = MAX_TEXT; textMax > MIN_TEXT; textMax -= 10) {
    const prompt = render(input, textMax);
    if (prompt.length <= MAX_PROMPT_CHARS) return prompt;
  }
  return render(input, MIN_TEXT);
}
