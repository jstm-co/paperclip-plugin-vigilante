# Vigilante for Paperclip

**English** · [Español](README.es.md)

[![npm](https://img.shields.io/npm/v/paperclip-plugin-vigilante)](https://www.npmjs.com/package/paperclip-plugin-vigilante) [![CI](https://github.com/jstm-co/paperclip-plugin-vigilante/actions/workflows/ci.yml/badge.svg)](https://github.com/jstm-co/paperclip-plugin-vigilante/actions/workflows/ci.yml)

A [Paperclip](https://github.com/paperclipai/paperclip) plugin that finds the issues your blocked chains are really waiting on, with a plain script (no AI), every 15 minutes.

- Plugin key: `jstm.vigilante` · npm package: `paperclip-plugin-vigilante`
- **Version 1 is watch-only.** It reports what it *would* do and changes nothing: it has no write capability at all.

## Why

Paperclip already has an automatic recovery sweep for `todo` and `in_progress` issues. What stays dead is the `blocked` state: chains of blocked issues hang from one **stopper** issue that nobody moves. Nobody is told, because every issue in the chain is "correctly" blocked.

Vigilante walks each company's open issues, follows every blocked issue that needs attention to the stopper at the end of its chain, and lists the stoppers: the ones nobody has touched for a while and that no run is working on.

## What it does

Every 15 minutes for each company that has the per-company switch **on** (see [Per-company switch](#per-company-switch)), and on demand with **Scan now** for the company you are looking at:

1. Lists the company's open issues (`backlog`, `todo`, `in_progress`, `in_review`, `blocked`).
2. For each blocked issue whose blocker attention is `needs_attention`, finds its stopper: the terminal blocker when it has unresolved blockers, or the issue itself.
3. Ignores stoppers that are moving: an active run, updated in the last 24 hours, or `done` / `cancelled`.
4. Classifies each stopper and says what version 2 would do.
5. Stores one record per company (plugin state, company scope) that the **Vigilante** page shows. It also remembers since when it has seen each stopper stuck. A failed scan of a company keeps its previous record and history.

The page shows the company you are in: the stopper (link to the issue), its kind, how long it has been quiet, how many issues it stops, what the watcher would do, and the reason text when there is one. The interface follows the browser language: Spanish by default, English when the browser is in English. A banner states that nothing is changed.

## Kinds

Evaluated in this order; the first match wins.

| Kind | When | Would do |
|---|---|---|
| `waiting_person` | Assigned to a person (and no agent) | nothing: Paperclip already asks the person |
| `backlog_unowned` | `backlog`, nobody assigned | report: a human must assign it |
| `backlog_assigned` | `backlog`, an agent assigned | move to `todo` |
| `waiting_third_party` | `blocked` with an unblock action text (the `deliberate_wait_without_target` recovery action counts too, but only when the host exposes it to plugins) | report, with the reason text |
| `gave_up` | `blocked` with an active `stranded_*` recovery action. **Only when the host exposes its recovery state to plugins; today such issues show as `blocked_unexplained`.** | wake the assignee |
| `blocked_unexplained` | `blocked`, an agent, no unresolved blockers, no explanation | wake the assignee |
| `other` | anything else that has been quiet too long (`todo`, `in_progress`, `in_review`...) | report |
| `unknown` | the stopper is not in the list of open issues | report (only the id is known) |

The list is sorted by the number of issues stopped, then by how long it has been quiet.

## Per-company switch

The 15-minute job runs without a company scope, so Paperclip only lets it touch the companies where the plugin has a saved configuration. That is why the plugin declares a per-company setting, **Scan this company every 15 minutes** (`enabled`, off by default):

- **On:** the scheduled scan covers the company.
- **Off (or never saved):** the scheduled scan skips it. The page's **Scan now** button still works for the company you are looking at; it rescans only that company and leaves the others' data alone.

Save the setting for each company you want covered (the host stores one configuration per company).

## Requirements

- Developed against the plugin SDK `2026.824.1`; behaviour verified by reading host `2026.1117.0`; not yet run on a live instance.
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

`upgrade` rejects a version that asks for new permissions. When the acting version (v2) arrives it will need some, so you will uninstall **without** `--force` and install again.

## Permissions and data

| Permission | What for |
|---|---|
| `companies.read` | Read the name and prefix of each scanned company. |
| `issues.read` | Read each scanned company's open issues. |
| `jobs.schedule` | The scan every 15 minutes. |
| `plugin.state.read`, `plugin.state.write` | Store the last snapshot and the first-seen times. This is the only thing the plugin writes, and only in its own state. |
| `ui.page.register`, `ui.sidebar.register`, `ui.action.register` | The page, its sidebar link and its button in the top toolbar. |

Deliberately absent: `issues.update`, `issues.wakeup` and any comment capability. Version 1 cannot change an issue. The plugin does not call any external service.

## Roadmap (version 2)

Version 2 will act, with hard limits:

- At most one action per issue every 24 hours.
- At most 3 attempts per stopper, then it only reports.
- A comment on the issue every time it acts, so the trail is visible.
- Keep the per-company switch, off by default.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md). MIT license.
