import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import {
  useHostLocation,
  useHostNavigation,
  usePluginAction,
  usePluginData,
  type PluginPageProps,
  type PluginSidebarProps,
} from "@paperclipai/plugin-sdk/ui";
import { detectLocale, formatDuration, translate, type Locale, type MessageKey } from "../i18n.js";
import { ACTION_SCAN_NOW, DATA_REPORT, MAX_NUDGES_PER_STOPPER, PAGE_ROUTE, type CompanySnapshot, type Report, type StopperView } from "../shared.js";
import { ensureStyles } from "./styles.js";

function useTr() {
  const locale = useMemo<Locale>(detectLocale, []);
  const tr = useCallback((key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values), [locale]);
  return { locale, tr };
}

function EyeIcon() {
  return (
    <svg className="h-4 w-4" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

// Sidebar entry; it copies the classes of the native sidebar item.
export function VigilanteSidebarLink(_props: PluginSidebarProps) {
  const navigation = useHostNavigation();
  const location = useHostLocation();
  const { tr } = useTr();
  const active = location.pathname.endsWith(`/${PAGE_ROUTE}`);
  return (
    <a
      {...navigation.linkProps(`/${PAGE_ROUTE}`)}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 mx-2 rounded-lg px-2 py-1.5 font-medium transition-colors ${
        active ? "bg-accent text-foreground" : "text-foreground/80 hover:bg-accent/50 hover:text-foreground"
      }`}
    >
      <span className="relative shrink-0">
        <EyeIcon />
      </span>
      <span className="flex-1 truncate">{tr("title")}</span>
    </a>
  );
}

/** Button in the host's top toolbar (slot `globalToolbarButton`): visible on every page, unlike sidebar slots. */
export function VigilanteToolbarButton() {
  const navigation = useHostNavigation();
  const location = useHostLocation();
  const { tr } = useTr();
  useLayoutEffect(() => ensureStyles(), []);
  const active = location.pathname.replace(/\/+$/, "").endsWith(`/${PAGE_ROUTE}`);
  return (
    <a
      {...navigation.linkProps(`/${PAGE_ROUTE}`)}
      aria-current={active ? "page" : undefined}
      aria-label={tr("title")}
      title={tr("toolbarHint")}
      className={`vg-tb${active ? " is-on" : ""}`}
    >
      <EyeIcon />
      <span className="vg-tb-lbl">{tr("title")}</span>
    </a>
  );
}

/** Plain `href` (full navigation): the host's own navigation prepends the active company and breaks links to other ones. */
function issueHref(company: CompanySnapshot, stopper: StopperView): string {
  const prefix = company.issuePrefix ?? company.id;
  return `/${prefix}/issues/${encodeURIComponent(stopper.identifier ?? stopper.issueId)}`;
}

function StopperRow({ company, stopper, locale, tr }: { company: CompanySnapshot; stopper: StopperView; locale: Locale; tr: ReturnType<typeof useTr>["tr"] }) {
  const stuckSince = new Date(stopper.firstSeenAt);
  return (
    <tr>
      <td>
        {stopper.title === null ? (
          <span className="vg-muted">{tr("unknownIssue", { id: stopper.issueId })}</span>
        ) : (
          <a href={issueHref(company, stopper)}>
            <span className="vg-id">{stopper.identifier ?? stopper.issueId.slice(0, 8)}</span>
            {stopper.title}
          </a>
        )}
        {stopper.reason ? <span className="vg-reason">{stopper.reason}</span> : null}
      </td>
      <td>{tr(`kind.${stopper.kind}`)}</td>
      <td>{stopper.quietMs === null ? "–" : formatDuration(locale, stopper.quietMs)}</td>
      <td>{stopper.stops}</td>
      <td>
        {tr(`do.${stopper.wouldDo}`, { name: stopper.targetAgentName ?? "?" })}
        <NudgeNote stopper={stopper} locale={locale} tr={tr} />
      </td>
      <td title={stuckSince.toLocaleString(locale)}>{formatDuration(locale, Math.max(0, Date.now() - stuckSince.getTime()))}</td>
    </tr>
  );
}

/** What was done about a `waiting_agent` stopper: the last wake, a skip or a failure. */
function NudgeNote({ stopper, locale, tr }: { stopper: StopperView; locale: Locale; tr: ReturnType<typeof useTr>["tr"] }) {
  const nudge = stopper.nudge;
  if (stopper.kind !== "waiting_agent" || !nudge) return null;
  const lines: string[] = [];
  if (nudge.count > 0) {
    const at = Date.parse(nudge.lastAt);
    lines.push(tr("nudge.woke", { name: nudge.targetAgentName, ago: Number.isNaN(at) ? "?" : formatDuration(locale, Math.max(0, Date.now() - at)), k: nudge.count, max: MAX_NUDGES_PER_STOPPER }));
    if (nudge.count >= MAX_NUDGES_PER_STOPPER) lines.push(tr("nudge.limit", { max: MAX_NUDGES_PER_STOPPER }));
  }
  if (nudge.lastError) lines.push(tr("nudge.failed", { message: nudge.lastError }));
  else if (nudge.lastSkip === "scan_cap") lines.push(tr("nudge.scanCap"));
  else if (nudge.lastSkip?.startsWith("not_idle:")) lines.push(tr("nudge.notIdle", { name: nudge.targetAgentName, status: nudge.lastSkip.slice("not_idle:".length) }));
  return (
    <>
      {lines.map((line) => (
        <span key={line} className="vg-reason">
          {line}
        </span>
      ))}
    </>
  );
}

type TableProps = { company: CompanySnapshot; locale: Locale; tr: ReturnType<typeof useTr>["tr"] };

/** Long-quiet stoppers first; the ones that moved recently go in their own table below. */
function CompanyTable({ company, locale, tr }: TableProps) {
  const quiet = company.stoppers.filter((stopper) => !stopper.recent);
  const recent = company.stoppers.filter((stopper) => stopper.recent);
  return (
    <>
      <StopperTable company={company} locale={locale} tr={tr} stoppers={quiet} title={tr("sectionQuiet")} />
      <StopperTable company={company} locale={locale} tr={tr} stoppers={recent} title={tr("sectionRecent")} note={tr("recentNote")} />
    </>
  );
}

function StopperTable({ company, locale, tr, stoppers, title, note }: TableProps & { stoppers: StopperView[]; title: string; note?: string }) {
  if (stoppers.length === 0) return null;
  return (
    <section>
      <h2 className="vg-company">
        {title}
        <span className="vg-count vg-muted">{tr(stoppers.length === 1 ? "issues.one" : "issues.many", { n: stoppers.length })}</span>
      </h2>
      {note ? <p className="vg-muted vg-note">{note}</p> : null}
      <div className="vg-wrap">
        <table>
          <thead>
            <tr>
              <th>{tr("colIssue")}</th>
              <th>{tr("colKind")}</th>
              <th>{tr("colQuiet")}</th>
              <th>{tr("colStops")}</th>
              <th>{tr("colWouldDo")}</th>
              <th>{tr("colSeen")}</th>
            </tr>
          </thead>
          <tbody>
            {stoppers.map((stopper) => (
              <StopperRow key={stopper.issueId} company={company} stopper={stopper} locale={locale} tr={tr} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function VigilantePage({ context }: PluginPageProps) {
  useLayoutEffect(() => ensureStyles(), []);
  const { locale, tr } = useTr();
  const params = { companyId: context.companyId };
  const report = usePluginData<Report>(DATA_REPORT, params);
  const scan = usePluginAction(ACTION_SCAN_NOW);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const scanNow = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await scan(params);
      report.refresh();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error));
    } finally {
      setBusy(false);
    }
  };

  const data = report.data;
  const company = data?.company ?? null;
  const errors = Array.isArray(data?.errors) ? data.errors : [];
  const scannedAt = company?.scannedAt ? new Date(company.scannedAt) : null;

  return (
    <div className="vg">
      <div className="vg-head">
        <h1 className="vg-title">{tr("title")}</h1>
        <span className="vg-muted">
          {company && scannedAt
            ? tr("lastScan", { when: scannedAt.toLocaleString(locale), ms: company.durationMs })
            : report.loading
              ? tr("loading")
              : tr("neverScanned")}
        </span>
        <span className="vg-grow" />
        <button type="button" className="vg-btn" onClick={scanNow} disabled={busy}>
          {busy ? tr("scanning") : tr("scanNow")}
        </button>
      </div>

      <div className="vg-banner" role="note">
        {tr(data?.act ? "bannerAct" : "banner")}
      </div>
      {data && !data.enabled ? (
        <div className="vg-banner" role="note">
          {tr("disabledNote")}
        </div>
      ) : null}

      {report.error ? <div className="vg-error">{tr("loadFailed", { message: report.error.message })}</div> : null}
      {failure ? <div className="vg-error">{tr("scanFailed", { message: failure })}</div> : null}
      {errors.length > 0 ? (
        <div className="vg-error">
          {tr("errorsTitle")}
          <ul>
            {errors.map((error, i) => (
              <li key={i}>
                {error.companyName || company?.name || error.companyId
                  ? tr("errorLine", { company: error.companyName || company?.name || error.companyId || "", message: error.message })
                  : error.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {company && company.stoppers.length === 0 && errors.length === 0 ? <div className="vg-empty">{tr("empty")}</div> : null}
      {company ? <CompanyTable company={company} locale={locale} tr={tr} /> : null}
    </div>
  );
}
