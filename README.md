# Vigilante for Paperclip

**English** · [Español](README.es.md)

[![npm](https://img.shields.io/npm/v/paperclip-plugin-vigilante)](https://www.npmjs.com/package/paperclip-plugin-vigilante) [![CI](https://github.com/jstm-co/paperclip-plugin-vigilante/actions/workflows/ci.yml/badge.svg)](https://github.com/jstm-co/paperclip-plugin-vigilante/actions/workflows/ci.yml)

A [Paperclip](https://github.com/paperclipai/paperclip) plugin that finds the issues your blocked chains are really waiting on, with a plain script (no AI), every 15 minutes.

- Plugin key: `jstm.vigilante` · npm package: `paperclip-plugin-vigilante`
- **Watching is the default.** Out of the box it reports what it *would* do and changes nothing. Acting is opt-in per company (`act`) and today does exactly one thing: it wakes the agent that another agent is waiting for (see [Acting](#acting-opt-in)). It never edits issues, never comments and never changes relations.

## Why

Paperclip already has an automatic recovery sweep for `todo` and `in_progress` issues. What stays dead is the `blocked` state: chains of blocked issues hang from one **stopper** issue that nobody moves. Nobody is told, because every issue in the chain is "correctly" blocked.

Vigilante walks each company's open issues, follows every blocked issue that needs attention to the stopper at the end of its chain, and lists the stoppers: the ones nobody has touched for a while and that no run is working on.

## What it does

Every 15 minutes for each company that has the per-company switch **on** (see [Per-company switch](#per-company-switch)), and on demand with **Scan now** for the company you are looking at:

1. Lists the company's open issues (`backlog`, `todo`, `in_progress`, `in_review`, `blocked`).
2. For each blocked issue whose blocker attention is `needs_attention`, finds its stopper: it follows the blockers to the end of the chain, or takes the issue itself when nothing blocks it.
3. For each `todo` or `in_progress` issue that has an agent and no run, reads its blockers: Paperclip cancels every wake of an open issue with unresolved blockers, yet it is not `blocked`, so step 2 does not see it. Each unresolved blocker counts as a stopper. At most 50 of these reads per company and scan.
4. Ignores stoppers with an active run and the `done` / `cancelled` ones. A stopper that moved in the last 24 hours is listed apart as recent, and nothing would be done to it yet.
5. Classifies each stopper and says what it would do (and, with `act` on for the company, does the one thing it can: see [Acting](#acting-opt-in)).
6. Stores one record per company (plugin state, company scope) that the **Vigilante** page shows. It also remembers since when it has seen each stopper stuck. A failed scan of a company keeps its previous record and history.

The page shows the company you are in: the stopper (link to the issue), its kind, how long it has been quiet, how many issues it stops, what the watcher would do, and the reason text when there is one. The interface follows the browser language: Spanish by default, English when the browser is in English. A banner tells the truth per company: "nothing is changed" when `act` is off, and which single action it takes when `act` is on.

## Kinds

Evaluated in this order; the first match wins.

| Kind | When | Would do |
|---|---|---|
| `waiting_person` | Assigned to a person (and no agent) | nothing: Paperclip already asks the person |
| `backlog_unowned` | `backlog`, nobody assigned | report: a human must assign it |
| `backlog_assigned` | `backlog`, an agent assigned | move to `todo` |
| `waiting_third_party` | `blocked` with an unblock action text (the `deliberate_wait_without_target` recovery action counts too, but only when the host exposes it to plugins) | report, with the reason text |
| `waiting_agent` | `blocked` with an unblock text that names exactly ONE agent of the company other than the issue's assignee (see [Acting](#acting-opt-in)) | wake that agent (`wake_other_agent`) once quiet for `actAfterMinutes`; report-only unless `act` is on |
| `gave_up` | `blocked` with an active `stranded_*` recovery action. **Only when the host exposes its recovery state to plugins; today such issues show as `blocked_unexplained`.** | wake the assignee |
| `blocked_unexplained` | `blocked`, an agent, no unresolved blockers, no explanation | wake the assignee |
| `open_no_run` | `todo`, `in_progress` or `in_review` with no run right now | report |
| `other` | anything else | report |
| `unknown` | the stopper is not in the list of open issues | report (only the id is known) |

Stoppers quiet for more than a day come first and recent ones go in their own table; each is sorted by the number of issues stopped, then by how long it has been quiet.

## Per-company switch

The 15-minute job runs without a company scope, so Paperclip only lets it touch the companies where the plugin has a saved configuration. That is why the plugin declares a per-company setting, **Scan this company every 15 minutes** (`enabled`, off by default):

- **On:** the scheduled scan covers the company.
- **Off (or never saved):** the scheduled scan skips it. The page's **Scan now** button still works for the company you are looking at; it rescans only that company and leaves the others' data alone.

Save the setting for each company you want covered (the host stores one configuration per company). The same per-company configuration holds three more settings:

| Setting | Default | What it does |
|---|---|---|
| `act` | off | Wake the agent another agent is waiting for (see [Acting](#acting-opt-in)). Separate from `enabled`. |
| `actAfterMinutes` | 30 (minimum 10) | Minutes a `waiting_agent` stopper must be quiet before it is woken. |
| `language` | `en` | `en` or `es`: language of the message sent to the woken agent and of the activity entry. |

Invalid values fall back to the defaults.

## Acting (opt-in)

An agent often leaves its issue `blocked` with an explanation such as "Waiting for the Tech Lead: keep the attribution of X and hand the issue back". The named agent is idle and nobody wakes it: the issue is not assigned to it, and its own issue is blocked by this one, so Paperclip cancels the wakes there. Vigilante wakes it, without AI.

- **Detection** is plain text matching: the agent names of the company are looked for inside the explanation text, ignoring case, accents and extra whitespace, on word boundaries. Terminated agents are ignored and the issue's own assignee does not count. If exactly one other agent is named (a longer name wins over a shorter one it contains), the stopper is `waiting_agent`. Two different agents, or none, stays `waiting_third_party`.
- **When:** once the stopper has been quiet for `actAfterMinutes` (default 30, minimum 10), whether or not it moved in the last 24 hours. Before that the page shows "nothing yet".
- **Only if** the company has `act` on and the scan runs for it (the 15-minute job needs `enabled` too; **Scan now** also acts when `act` is on).
- **Limits**, kept in the company's record: at most one wake per stopper every 24 hours, at most 3 per stopper while it stays stuck (the history is dropped when the issue stops being a stopper), at most 5 per company and scan. A target that is not `idle` (running, paused, error...) is skipped and retried on the next scan without counting. A failed wake is recorded with its message, does not count and does not stop the scan.
- **The message** is a short plain-text notice in the company's `language`: that it is automatic (no AI), the issue identifier and title, who holds it, that it is blocked waiting for the recipient, the explanation text, how long it has been quiet, and what is expected (open the issue and do what it asks, or comment on it if it is not theirs).
- **The trail:** an activity log entry on the issue, attributed to the plugin, says who was woken and why. It posts no comment (a comment would wake the issue's assignee).

The page shows "Wake <name>" for these rows and, once done, "Woke <name> 2 h ago (1 of 3)", or why it was skipped or failed.

## Requirements

- Developed against the plugin SDK `2026.824.1`; run on a live host `2026.1117.0` (page, Scan now, the per-company switch and a manually triggered scan job).
- Board access to the instance. In `local_trusted` mode any local process has it; in `authenticated` mode, sign in first with `npx paperclipai auth login`.
- To install from npm: npm on the machine where Paperclip runs. To install from source: Node.js 20 or later and npm.

## Installation

### From npm

```bash
npx paperclipai plugin install paperclip-plugin-vigilante
npx paperclipai plugin list        # jstm.vigilante, status=ready
```

### From source

Paperclip loads the plugin from a local folder and does not copy the code: keep the folder where it is while you use the plugin.

```bash
git clone https://github.com/jstm-co/paperclip-plugin-vigilante.git
cd paperclip-plugin-vigilante
npm ci
npm run build
npx paperclipai plugin install "$PWD"
npx paperclipai plugin list        # jstm.vigilante, status=ready
```

If your instance is not at the default address, add `--api-base <url>` to the `paperclipai` commands. Then reload Paperclip: "Vigilante" shows up in the top toolbar (Paperclip's default Coordinator workspace does not render plugin sidebar links) and in the sidebar where it is drawn. You can also open `/<company-prefix>/vigilante`. Then turn on the per-company switch.

## Upgrading and uninstalling

```bash
npx paperclipai plugin upgrade jstm.vigilante
npx paperclipai plugin uninstall jstm.vigilante            # keeps the record and data
npx paperclipai plugin uninstall jstm.vigilante --force    # deletes everything
```

`upgrade` rejects a version that asks for new permissions. The version that adds acting asks for three (`agents.read`, `agents.invoke`, `activity.log.write`), so an existing install has to be uninstalled **without** `--force` and installed again.

## Permissions and data

| Permission | What for |
|---|---|
| `companies.read` | Read the name and prefix of each scanned company. |
| `issues.read` | Read each scanned company's open issues. |
| `issue.relations.read` | Read which issues block an open one that is not `blocked` itself. |
| `jobs.schedule` | The scan every 15 minutes. |
| `plugin.state.read`, `plugin.state.write` | Store the last snapshot, the first-seen times and the wake history, in the plugin's own state. |
| `agents.read` | List the company's agents (id, name, status) once per scan, to match the names in explanation texts. |
| `agents.invoke` | Wake the agent another agent is waiting for. Only with `act` on. |
| `activity.log.write` | Write the activity entry that records each wake. |
| `ui.page.register`, `ui.sidebar.register`, `ui.action.register` | The page, its sidebar link and its button in the top toolbar. |

Deliberately absent: `issues.update`, `issues.wakeup`, any comment capability and relation writes. The plugin cannot edit an issue, comment or change relations; the only things it can do besides watching are waking an agent and writing an activity entry. It does not call any external service.

## Roadmap

Not implemented yet, and still report-only: `promote_to_todo` (move a backlog issue with an agent to `todo`) and `wake_assignee` (wake the agent that holds an unexplained blocked issue). Promoting backlog work will need a confirmation step, because a backlog item may be parked on purpose. Any new action will keep the same rules: opt-in per company, capped, and never editing issues without a human in the loop.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md). MIT license.
