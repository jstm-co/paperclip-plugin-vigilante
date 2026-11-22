// Own stylesheet: the host only ships the Tailwind classes its core uses. Tokens
// live in `.vg` and follow the host's `.dark` class.
const CSS = /* css */ `
.vg, .vg-tb {
  --vg-fg: #0a0a0a; --vg-muted-fg: #737373; --vg-card: #ffffff; --vg-border: #e5e5e5; --vg-head: #f5f5f5;
  --vg-primary: #171717; --vg-primary-fg: #fafafa; --vg-hover: rgba(0,0,0,.04);
  --vg-warn-bg: #fff6db; --vg-warn-border: #ecd9a0; --vg-warn-fg: #7a5000;
  --vg-danger-bg: rgba(220,38,38,.07); --vg-danger-border: rgba(220,38,38,.35); --vg-danger-fg: #b91c1c;
  color: var(--vg-fg);
}
.vg { font-size: 14px; line-height: 20px; padding: 16px 0; }
.dark .vg, .dark .vg-tb {
  --vg-fg: #fafafa; --vg-muted-fg: #a1a1a1; --vg-card: #171717; --vg-border: rgba(255,255,255,.10); --vg-head: #262626;
  --vg-primary: #e5e5e5; --vg-primary-fg: #171717; --vg-hover: rgba(255,255,255,.04);
  --vg-warn-bg: #2f2812; --vg-warn-border: #5c4c1d; --vg-warn-fg: #f2b544;
  --vg-danger-bg: rgba(239,68,68,.08); --vg-danger-border: rgba(239,68,68,.45); --vg-danger-fg: #fca5a5;
}
.vg * { box-sizing: border-box; }
/* Button in the host's top toolbar: same height as its neighbours. */
.vg-tb { box-sizing: border-box; height: 32px; display: inline-flex; align-items: center; gap: 6px; padding: 0 10px 0 8px; border-radius: 8px; border: 1px solid var(--vg-border); background: transparent; font-size: 13px; line-height: 20px; font-weight: 500; white-space: nowrap; text-decoration: none; cursor: pointer; }
.vg-tb:hover { background: var(--vg-hover); }
.vg-tb.is-on { background: var(--vg-head); }
.vg-tb svg { width: 16px; height: 16px; flex: none; }
@media (max-width: 640px) { .vg-tb { border: 0; padding: 0 6px; } .vg-tb .vg-tb-lbl { display: none; } }
.vg-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.vg-title { font-size: 20px; line-height: 28px; font-weight: 600; margin: 0; }
.vg-grow { flex: 1; }
.vg-muted { color: var(--vg-muted-fg); }
.vg-btn { border: 1px solid var(--vg-border); background: var(--vg-primary); color: var(--vg-primary-fg); border-radius: 8px; padding: 6px 12px; font: inherit; cursor: pointer; }
.vg-btn[disabled] { opacity: .6; cursor: default; }
.vg-banner { border: 1px solid var(--vg-warn-border); background: var(--vg-warn-bg); color: var(--vg-warn-fg); border-radius: 8px; padding: 8px 12px; margin-bottom: 16px; }
.vg-error { border: 1px solid var(--vg-danger-border); background: var(--vg-danger-bg); color: var(--vg-danger-fg); border-radius: 8px; padding: 8px 12px; margin-bottom: 16px; }
.vg-error ul { margin: 4px 0 0; padding-left: 18px; }
.vg-company { margin: 20px 0 8px; font-size: 15px; font-weight: 600; }
.vg-count { margin-left: 8px; font-weight: 400; }
.vg-wrap { overflow-x: auto; border: 1px solid var(--vg-border); border-radius: 8px; background: var(--vg-card); }
.vg table { border-collapse: collapse; width: 100%; min-width: 760px; }
.vg th { text-align: left; font-weight: 500; color: var(--vg-muted-fg); background: var(--vg-head); padding: 6px 12px; white-space: nowrap; }
.vg td { padding: 8px 12px; border-top: 1px solid var(--vg-border); vertical-align: top; }
.vg tbody tr:hover { background: var(--vg-hover); }
.vg a { color: inherit; text-decoration: none; }
.vg a:hover { text-decoration: underline; }
.vg-id { font-weight: 600; margin-right: 6px; }
.vg-reason { display: block; margin-top: 2px; color: var(--vg-muted-fg); font-size: 12px; line-height: 16px; }
.vg-empty { border: 1px dashed var(--vg-border); border-radius: 8px; padding: 24px; text-align: center; color: var(--vg-muted-fg); }
`;

export function ensureStyles(): void {
  if (typeof document === "undefined" || document.getElementById("vigilante-styles")) return;
  const style = document.createElement("style");
  style.id = "vigilante-styles";
  style.textContent = CSS;
  document.head.appendChild(style);
}
