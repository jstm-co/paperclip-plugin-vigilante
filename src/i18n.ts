// Tiny dictionary-based i18n: Spanish (default) and English (when the host
// locale is English). Keys are stable ids, not sentences.
export type Locale = "es" | "en";

const en = {
  "title": "Vigilante",
  "banner": "Watch-only mode: nothing is changed. This page only reports what it would do.",
  "lastScan": "Last scan: {when} ({ms} ms)",
  "neverScanned": "No scan has run yet.",
  "scanNow": "Scan now",
  "scanning": "Scanning…",
  "loading": "Loading…",
  "loadFailed": "Could not load the report: {message}",
  "scanFailed": "The scan failed: {message}",
  "disabledNote": "The 15-minute scan is off for this company. Turn it on in the plugin settings for this company. Scan now still works.",
  "errorLine": "{company}: {message}",
  "toolbarHint": "Vigilante: blocked chains stopped by a quiet issue",
  "empty": "Nothing is stuck. No blocked chain is waiting on a quiet issue.",
  "errorsTitle": "The last scan failed",
  "colIssue": "Stopper",
  "colKind": "Kind",
  "colQuiet": "Quiet for",
  "colStops": "Stops",
  "colWouldDo": "Would do",
  "colSeen": "Seen stuck since",
  "unknownIssue": "Issue not in the list ({id})",
  "kind.waiting_person": "Waiting for a person",
  "kind.backlog_unowned": "In backlog, nobody assigned",
  "kind.backlog_assigned": "In backlog, agent assigned",
  "kind.waiting_third_party": "Waiting for a third party",
  "kind.gave_up": "Agent gave up",
  "kind.blocked_unexplained": "Blocked without explanation",
  "kind.open_no_run": "Open, no run right now",
  "kind.other": "Quiet, no clear cause",
  "kind.unknown": "Unknown",
  "do.none": "Nothing (Paperclip already asks the person)",
  "do.wait": "Nothing yet (too soon)",
  "do.report": "Report only",
  "do.promote_to_todo": "Move to todo",
  "do.wake_assignee": "Wake the assignee",
  "ago.now": "just now",
  "ago.minutes": "{n} min",
  "ago.hours": "{n} h",
  "ago.days": "{n} d",
  "sectionQuiet": "Quiet for more than a day",
  "sectionRecent": "Stuck for less than a day",
  "recentNote": "These moved recently. Paperclip may still move them on its own, so nothing would be done yet.",
  "issues.one": "1 issue",
  "issues.many": "{n} issues",
} as const;

export type MessageKey = keyof typeof en;

const es: Record<MessageKey, string> = {
  "title": "Vigilante",
  "banner": "Modo solo vigilancia: no se cambia nada. Esta página solo informa lo que haría.",
  "lastScan": "Último escaneo: {when} ({ms} ms)",
  "neverScanned": "Aún no se ha hecho ningún escaneo.",
  "scanNow": "Escanear ahora",
  "scanning": "Escaneando…",
  "loading": "Cargando…",
  "loadFailed": "No se pudo cargar el informe: {message}",
  "scanFailed": "El escaneo falló: {message}",
  "disabledNote": "El escaneo de cada 15 minutos está apagado para esta empresa. Actívalo en la configuración del plugin para esta empresa. Escanear ahora funciona igual.",
  "errorLine": "{company}: {message}",
  "toolbarHint": "Vigilante: cadenas bloqueadas frenadas por una tarea quieta",
  "empty": "Nada atascado. Ninguna cadena bloqueada espera a una tarea quieta.",
  "errorsTitle": "El último escaneo falló",
  "colIssue": "Tarea que frena",
  "colKind": "Tipo",
  "colQuiet": "Quieta hace",
  "colStops": "Frena",
  "colWouldDo": "Haría",
  "colSeen": "Atascada desde",
  "unknownIssue": "Tarea fuera de la lista ({id})",
  "kind.waiting_person": "Espera a una persona",
  "kind.backlog_unowned": "En backlog, sin asignar",
  "kind.backlog_assigned": "En backlog, con agente",
  "kind.waiting_third_party": "Espera a un tercero",
  "kind.gave_up": "El agente se rindió",
  "kind.blocked_unexplained": "Bloqueada sin explicación",
  "kind.open_no_run": "Abierta, sin corrida ahora",
  "kind.other": "Quieta, sin causa clara",
  "kind.unknown": "Desconocida",
  "do.none": "Nada (Paperclip ya le avisa a la persona)",
  "do.wait": "Nada todavía (muy pronto)",
  "do.report": "Solo informar",
  "do.promote_to_todo": "Pasar a por hacer",
  "do.wake_assignee": "Despertar al responsable",
  "ago.now": "ahora mismo",
  "ago.minutes": "{n} min",
  "ago.hours": "{n} h",
  "ago.days": "{n} d",
  "sectionQuiet": "Quietas hace más de un día",
  "sectionRecent": "Trabadas hace menos de un día",
  "recentNote": "Se movieron hace poco. Paperclip todavía puede moverlas solo, así que aún no se haría nada.",
  "issues.one": "1 tarea",
  "issues.many": "{n} tareas",
};

export const CATALOGS: Record<Locale, Record<MessageKey, string>> = { en, es };

/** Spanish unless the host (browser) locale is English. */
export function pickLocale(languages: readonly string[]): Locale {
  const first = languages[0]?.toLowerCase() ?? "";
  return first === "en" || first.startsWith("en-") ? "en" : "es";
}

export function detectLocale(): Locale {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  return pickLocale(nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : []);
}

export function translate(locale: Locale, key: MessageKey, values?: Readonly<Record<string, string | number>>): string {
  const text = CATALOGS[locale][key];
  return values ? text.replace(/\{(\w+)\}/g, (token, name: string) => (Object.hasOwn(values, name) ? String(values[name]) : token)) : text;
}

/** "5 min", "3 h", "2 d" from a duration in milliseconds. */
export function formatDuration(locale: Locale, ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return translate(locale, "ago.now");
  if (minutes < 60) return translate(locale, "ago.minutes", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return translate(locale, "ago.hours", { n: hours });
  return translate(locale, "ago.days", { n: Math.floor(hours / 24) });
}
