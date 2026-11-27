# FlagPilot — feature request → Flagsmith experiment, with a human approval gate

**Toggle Wars (Flagsmith) — Track 02 "AI Agents and Feature Flags" entry.**

Paste a feature request. FlagPilot drafts a multivariate flag + metric +
experiment, shows you the exact plan, and only creates it in Flagsmith after
**you approve**. Nothing is ever created silently.

```text
$ node flagpilot.mjs plan "Test the copy on the checkout button: 'Buy now' vs 'Complete purchase', success is a completed purchase."

Flag:        checkout_button  (Checkout Button)
Hypothesis:  Changing checkout button from "Buy now" to "Complete purchase" will increase purchase (measured by event "purchase_completed").
Variants:
  - control        "Buy now"  — 50% of traffic
  - challenger_1   "Complete purchase"  — 50% of traffic
Metric:      Purchase  (event "purchase_completed", occurrence, direction up)
Rollout:     100% of users enter the experiment

$ node flagpilot.mjs apply --approve
[HUMAN APPROVAL RECORDED — --approve flag]
Mode: mock (no credentials needed)
Creating multivariate flag…
Creating metric…
Creating experiment…

Experiment created in Flagsmith
  Flag:        checkout_button  (id 1000)
  Metric:      Purchase  (id 1002, event "purchase_completed")
  Experiment:  Checkout Button — checkout_button  (id 1003, status draft)
  ...
```

## Why this exists

Setting up a Flagsmith experiment by hand is ~15 minutes of dashboard
clicking per test: create the flag, add each variant with a key, create the
metric, wire the experiment, set the split. FlagPilot turns one sentence into
that whole setup — but the agent never ships anything on its own: the plan is
printed first, and creation only happens after a human says yes. That is the
Track 02 judging line: *the interesting part is deciding what the agent does
on its own and where it stops to ask a person.*

## Try it in under 2 minutes (no credentials)

```bash
node flagpilot.mjs demo --mock --approve   # full flow, canned checkout-button test
node flagpilot.mjs plan "Compare the signup form: three-field vs six-field, success is a new signup."
node flagpilot.mjs apply --dry-run         # see what WOULD be created, create nothing
node flagpilot.mjs apply --approve --mock  # create it in the mock backend
node flagpilot.mjs status --experiment 1003 --mock
npm test                                    # 7 tests, zero dependencies
```

Judges: `demo --mock` is the whole story in one command. No API key, no
account, no network.

## Real Flagsmith (Cloud, free tier)

```bash
cp .env.example .env   # fill in the three values, never commit .env
node flagpilot.mjs projects                 # list your projects
node flagpilot.mjs plan "<your prompt>"
node flagpilot.mjs apply --approve --start # create + start the experiment
```

- `FLAGSMITH_API_KEY` — from the Flagsmith dashboard (Organisation settings →
  API keys). Sent as `Authorization: Token <key>`; if Cloud rejects that, the
  client retries once with `Api-Key <key>` and says so.
- `FLAGSMITH_PROJECT_ID` — numeric id of your project.
- `FLAGSMITH_ENVIRONMENT_KEY` — the environment key (e.g. Development).
- The environment needs a warehouse connection for experiments
  (`GET /environments/{key}/warehouse-connections/`); FlagPilot checks this
  before creating anything and links the setup docs if it is missing.

What gets created (exactly what the plan shows, nothing more):
1. Multivariate flag (`POST /api/v1/projects/{id}/features/`, type
   `MULTIVARIATE`, initial value `control`), one `mv-options` entry per
   challenger variant.
2. Metric (`POST /api/v1/environments/{key}/experiment-metrics/`,
   `occurrence` / `up`, event from the plan).
3. Experiment (`POST /api/v1/environments/{key}/experiments/`) with the
   rollout split from the plan. `--start` starts it (`.../start/`).

## Optional: LLM parsing (Gemini free tier)

```bash
node flagpilot.mjs plan "<prompt>" --llm gemini
```

Parses the prompt with Gemini (`gemini-3.8-flash`, free tier) via the
`custom.gemini` connector helper. If the LLM call fails or returns invalid
JSON, FlagPilot falls back to the built-in rule-based parser — the CLI never
blocks on the LLM. The rule-based parser is the default and is what the demo
uses.

## Safety

- **Human approval gate:** `apply` without `--approve` asks interactively;
  in a non-interactive run without `--approve` it refuses outright.
- **Dry-run first:** `plan` never touches Flagsmith; `apply --dry-run`
  prints exactly what would be created.
- **No secrets in the repo:** `.env` is git-ignored; the mock backend stores
  state locally in `.flagpilot/` (also ignored).
- **Mock by default:** with no API key set, real mode refuses and the tool
  falls back to mock with a clear notice.

## Stack

Node.js 20+, zero dependencies. No build step. `flagpilot.mjs` + `src/`
(parser, plan validation/rendering, real REST client, mock backend, optional
Gemini parser) + `test/` (node:test).

## Track

Toggle Wars (Flagsmith) — Track 02 "AI Agents and Feature Flags", $1,000.
Hackathon 26–29 Nov 2026, WeMakeDevs. Submission closes 29 Nov 20:00 IST
(21:30 WIB).
