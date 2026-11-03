# qa-reviewer

A quality assurance agent for Claude Code. It runs a full acceptance test of a web application (UI, UX, features, bugs, responsive) and proves it missed nothing: every check is a cell, and every cell comes back with a status and a piece of evidence. The result is a PDF report saved to your Downloads folder: summary tables first, then one section per issue with an annotated screenshot where the defect is framed and captioned, and, when the [screencaster](https://github.com/vladnacht/screencaster) plugin is installed, a short demo video of each issue.

Lire en français : [README.fr.md](README.fr.md).

## How it works

```
qa-reviewer                          orchestrator (layer 1)
├── qa-cartographer                  feature-node graph + sweep of every page
├── qa-lead-functional ─ qa-fn-flows · qa-fn-rules · qa-fn-permissions · qa-fn-data
├── qa-lead-ui ───────── qa-ui-layout · qa-ui-design · qa-ui-states · qa-ui-content
├── qa-lead-ux ───────── qa-ux-journey · qa-ux-feedback · qa-ux-copy · qa-ux-a11y
├── qa-lead-bugs ─────── qa-bug-inputs · qa-bug-network · qa-bug-concurrency · qa-bug-navigation
├── qa-lead-responsive ─ qa-rsp-breakpoints · qa-rsp-touch · qa-rsp-parity · qa-rsp-zoom
├── qa-gap-hunter                    coverage gaps → second wave
├── qa-controller                    replays every P0 and P1, merges, writes the report
├── qa-illustrator                   one annotated screenshot per issue
└── qa-videographer                  one demo video per issue, filmed by screencaster
```

1. **Map.** The cartographer inventories the code (`qa.mjs discover`), starts the app with the project's own commands, prepares test accounts, sweeps every viewport and builds `feature-graph.json`: every page, modal, form, layout and endpoint, with its states, actions, fields and roles, and the flows that connect them. `qa.mjs graph-check` rejects the graph while a file, route, link or action seen in the code or on screen is missing from it.
2. **Matrix.** `qa.mjs matrix` crosses the graph with the 57 checks of `references/checks.json` (per state, field, action, role and viewport). Scripts, not the model, decide what must be tested.
3. **First wave.** Each domain lead splits its cells into batches, runs its four specialists in parallel, validates their reports (`qa.mjs reports`: no cell may be missing) and consolidates.
4. **Second wave.** `qa.mjs coverage` lists empty or blocked cells. The gap hunter drops permanent blockers, adds what the matrix cannot see, and sends the domains back to work.
5. **Control.** The controller replays every P0 and P1, rejects what is not proven, merges issues by root cause across domains and writes `consolidated.json`.
6. **Figures and videos.** Illustrators replay each issue, frame the defect on the page with numbered red boxes and short labels (`scripts/mark.mjs`), and take the screenshot. If screencaster is installed, the videographer has it film each issue that can be seen on screen.
7. **PDF.** `scripts/report.mjs` turns all of this into `qa-report-<project>-<run>.pdf` in your Downloads folder, with the videos next to it.

qa-reviewer observes and proves. It never changes the code of the project under test.

## Installation

Requirements: Claude Code and Node.js 18 or later. Google Chrome or Edge is used when installed; otherwise Chromium is downloaded on the first run.

In Claude Code:

```
/plugin install qa-reviewer --marketplace vladnacht/qa-reviewer
```

or from a terminal:

```bash
claude plugin marketplace add vladnacht/qa-reviewer
```

```bash
claude plugin install qa-reviewer@qa-reviewer
```

Restart Claude Code. On the first run the agent installs its own dependencies (`@playwright/cli`, `axe-core`: a few seconds) and, if no browser is available, Chromium (about a minute).

For demo videos, also install screencaster:

```bash
claude plugin marketplace add vladnacht/screencaster
```

```bash
claude plugin install screencaster@screencaster
```

## Usage

In the project to test:

```bash
claude --agent qa-reviewer:qa-reviewer
```

or, in any session: "Run the qa-reviewer agent on this project, quick depth".

| Parameter | Default | Effect |
|---|---|---|
| depth | `standard` | `quick`: the full set on critical flows and a baseline of 8 checks on every other page, desktop and mobile, no second wave · `standard`: everything, desktop, tablet, mobile · `exhaustive`: six viewports from 320 to 1920 px and extra checks |
| URL | started by the cartographer | localhost, or a test environment you name, only |
| scope | the whole app | specific routes or flows |
| videos | `all` when screencaster is installed | `all` · `critical` (P0 and P1) · `none` |
| PDF folder | Downloads | `QA_REVIEWER_OUTPUT_DIR`, or a folder you name |

## What it produces

| Where | What |
|---|---|
| `~/Downloads/qa-report-<project>-<run>.pdf` | the report: issue counts by severity, summary by domain, table of every issue, then one section per issue with its annotated figure and legend, reproduction steps, expected and actual result, cause, re-test and video |
| `~/Downloads/qa-report-<project>-<run>-videos/` | the demo videos, when screencaster filmed them |
| `<project>/.qa-reviewer/runs/<run>/` (excluded from git) | `report.md`, `consolidated.json` (machine-readable, format in `references/report-contract.md`), `feature-graph.json`, `matrix/coverage.json`, screenshots and sweeps |

## Network and data

- **No telemetry.** qa-reviewer sends nothing anywhere. It has no server and makes no network call of its own.
- **What it opens:** only the application under test, on `localhost` or on a test environment you named yourself. It never targets production.
- **What it runs:** the project's own start commands (`npm run dev`, `docker compose up`, …) to launch the app, Node.js scripts from this plugin, and a headless browser (Playwright). Everything it starts is listed in the run folder and stopped at the end (`qa.mjs teardown`).
- **Downloads:** on the first run only, npm packages from the npm registry (`@playwright/cli`, `axe-core`) and, if no browser is installed, Chromium from Playwright's CDN.
- **Credentials:** to test logged-in pages it uses the test accounts of the project (seed, fixtures, `.env.example`) or creates local `qa-` accounts. It never writes a password into a report; `accounts.md` only says where a password comes from.
- **Files it writes:** the run folder inside the tested project (excluded from git), and the PDF and videos in your Downloads folder. It never modifies the project's code or configuration.
- **Videos:** recorded by the screencaster plugin when installed, under that plugin's own rules, then copied next to the PDF.

## Cost

On a real application, expect several dozen subagents, plus three per video. `matrix` prints the number of cells before the domain leads start; the orchestrator asks for confirmation above about 40 subagents. For a first try, use `quick` on a narrow scope.

## Development

```bash
git clone https://github.com/vladnacht/qa-reviewer.git && cd qa-reviewer
```

```bash
npm install && npm run doctor && npm run selftest
```

To load your working copy in a session without installing the plugin:

```bash
claude --plugin-dir ~/path/to/qa-reviewer
```

`npm run selftest` starts the mini app in `tests/` (with planted defects) and checks that the scripts still catch them, that `mark.mjs` frames defects, and that `report.mjs` writes the PDF.

```
.claude-plugin/  plugin.json and marketplace.json (the repository is its own marketplace)
agents/          31 agent definitions
references/      checks.json (the catalog), contracts, shared protocols, browser recipes, guardrails
scripts/         qa.mjs (inventory, graph, matrix, batches, reports, coverage, waves, teardown), sweep.mjs, mark.mjs, report.mjs, doctor.mjs
tests/           mini app with planted defects, test graph, self-test
```

Adding a check: an entry in `references/checks.json` (specialist, node kinds, dimensions, depth), then a section with the same id in the specialist's file. The agent instructions and the PDF report are written in French.

## License

MIT
