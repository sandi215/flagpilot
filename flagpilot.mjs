#!/usr/bin/env node
// FlagPilot — turn a feature request into a Flagsmith multivariate experiment,
// with a human approval gate. Toggle Wars (Flagsmith) Track 2 entry.
//
//   flagpilot plan "<prompt>" [--llm gemini] [--out path]
//   flagpilot apply [--plan path] [--approve] [--dry-run] [--mock] [--start]
//   flagpilot status --experiment <id> [--mock]
//   flagpilot demo [--mock] [--approve]
//   flagpilot projects [--mock]
//
// Safety model (this is the whole point of the tool):
//   - Default is --dry-run thinking: `plan` never touches Flagsmith.
//   - `apply` NEVER writes without human approval: interactive prompt when a
//     TTY is present, --approve flag otherwise. Non-TTY without --approve
//     refuses outright. Approval is recorded in the output.
//   - --mock (or no FLAGSMITH_API_KEY) runs against a local mock backend, so
//     judges can run the full flow with zero credentials.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { parsePrompt } from "./src/parser.mjs";
import { validatePlan, renderPlan, renderResult } from "./src/plan.mjs";
import { FlagsmithClient } from "./src/flagsmith.mjs";
import { MockFlagsmith } from "./src/mock.mjs";
import { parseWithGemini } from "./src/llm.mjs";

const VERSION = "0.1.0";
const DEFAULT_PLAN_PATH = ".flagpilot/plan.json";
const DEMO_PROMPT =
  "Test the copy on the checkout button: 'Buy now' vs 'Complete purchase', success is a completed purchase.";

// ---- tiny .env loader (zero deps) ----
function loadEnv() {
  for (const p of [".env", ".flagpilot/.env"]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

// ---- arg parsing ----
function parseArgs(argv) {
  const args = { _: [] };
  const VALUE_FLAGS = new Set(["plan", "out", "experiment", "llm"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (v !== undefined) {
        args[k] = v;
      } else if (VALUE_FLAGS.has(k) && i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        args[k] = argv[++i];
      } else {
        args[k] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function usage() {
  console.log(`FlagPilot v${VERSION} — feature request -> Flagsmith experiment (human approval required)

Usage:
  flagpilot plan "<prompt>" [--llm gemini] [--out path]
      Draft an experiment plan. Never touches Flagsmith. Default save: ${DEFAULT_PLAN_PATH}
  flagpilot apply [--plan path] [--approve] [--dry-run] [--mock] [--start]
      Show the plan, get human approval, then create flag + metric + experiment.
      Default: interactive approval prompt. Non-TTY without --approve refuses.
  flagpilot status --experiment <id> [--mock]
      Show experiment results (win probability per variant).
  flagpilot demo [--mock] [--approve]
      Full canned demo (checkout button A/B test) end to end.
  flagpilot projects [--mock]
      List Flagsmith projects (real or mock).

Modes:
  --mock   use the local mock backend (no credentials, no network).
  Real mode needs .env: FLAGSMITH_API_KEY, FLAGSMITH_PROJECT_ID,
  FLAGSMITH_ENVIRONMENT_KEY (see .env.example). Without a key, real mode
  refuses and tells you to use --mock.`);
}

async function askApproval(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

function buildBackend(args) {
  loadEnv();
  if (args.mock || !process.env.FLAGSMITH_API_KEY) {
    if (!args.mock && !process.env.FLAGSMITH_API_KEY) {
      console.error("No FLAGSMITH_API_KEY found — using mock backend. (Pass --mock explicitly, or set the key in .env for real mode.)");
    }
    return { backend: new MockFlagsmith({}), mode: "mock" };
  }
  return {
    backend: new FlagsmithClient({
      apiKey: process.env.FLAGSMITH_API_KEY,
      projectId: process.env.FLAGSMITH_PROJECT_ID,
      environmentKey: process.env.FLAGSMITH_ENVIRONMENT_KEY,
      baseUrl: process.env.FLAGSMITH_API_URL,
      dashboardUrl: process.env.FLAGSMITH_DASHBOARD_URL,
    }),
    mode: "real",
  };
}

async function cmdPlan(args) {
  const prompt = args._.join(" ");
  let plan;
  if (args.llm === "gemini") {
    try {
      console.error("Parsing with Gemini (free tier)…");
      plan = await parseWithGemini(prompt);
    } catch (err) {
      console.error(`Gemini parse failed (${err.message}) — falling back to rule-based parser.`);
      plan = parsePrompt(prompt);
    }
  } else {
    plan = parsePrompt(prompt);
  }
  const errors = validatePlan(plan);
  if (errors.length) {
    console.error("Plan failed validation:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }
  const out = args.out || DEFAULT_PLAN_PATH;
  mkdirSync(".flagpilot", { recursive: true });
  writeFileSync(out, JSON.stringify(plan, null, 2));
  console.log(renderPlan(plan));
  console.log(`\nPlan saved to ${out}. Review it, then run: flagpilot apply --plan ${out}`);
}

async function cmdApply(args) {
  const planPath = args.plan || DEFAULT_PLAN_PATH;
  if (!existsSync(planPath)) {
    console.error(`No plan found at ${planPath}. Run "flagpilot plan \\"<prompt>\\"" first.`);
    process.exitCode = 1;
    return;
  }
  const plan = JSON.parse(readFileSync(planPath, "utf8"));
  const errors = validatePlan(plan);
  if (errors.length) {
    console.error("Plan failed validation:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }

  console.log("=== PLAN TO APPLY ===");
  console.log(renderPlan(plan));
  console.log("=====================");

  if (args["dry-run"]) {
    console.log("\n--dry-run: nothing was created. Re-run without --dry-run (and with approval) to apply.");
    return;
  }

  // ---- HUMAN APPROVAL GATE ----
  let approved = false;
  if (args.approve) {
    approved = true;
    console.log("\n[HUMAN APPROVAL RECORDED — --approve flag]");
  } else if (process.stdin.isTTY) {
    approved = await askApproval("\nApply this plan to Flagsmith? [y/N] ");
  } else {
    console.error("\nREFUSED: no human approval. Re-run with --approve, or run interactively so you can confirm.");
    process.exitCode = 1;
    return;
  }
  if (!approved) {
    console.log("Not approved — nothing was created.");
    return;
  }

  const { backend, mode } = buildBackend(args);
  console.log(`\nMode: ${mode}${mode === "mock" ? " (no credentials needed)" : ""}`);

  if (mode === "real") {
    const hasWarehouse = await backend.checkWarehouse();
    if (!hasWarehouse) {
      console.error(
        "This environment has no warehouse connection, so Flagsmith cannot run experiments.\n" +
          "Connect one first: https://docs.flagsmith.com/experimentation/connect-a-warehouse",
      );
      process.exitCode = 1;
      return;
    }
  }

  console.log("Creating multivariate flag…");
  const { featureId, variantIds } = await backend.createFeature(plan);
  console.log(`  flag id ${featureId}, variants: ${Object.entries(variantIds).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log("Creating metric…");
  const metricId = await backend.createMetric(plan);
  console.log(`  metric id ${metricId} (event "${plan.metric.event}")`);
  console.log("Creating experiment…");
  const experimentId = await backend.createExperiment(plan, featureId, metricId, variantIds);
  let status = "draft";
  if (args.start) {
    console.log("Starting experiment…");
    status = await backend.startExperiment(experimentId);
  }
  console.log("");
  console.log(renderResult(plan, {
    featureId,
    metricId,
    experimentId,
    experimentName: `${plan.title} — ${plan.flag}`,
    status,
    dashboardUrl: backend.dashboardExperimentUrl(experimentId),
  }));
}

async function cmdStatus(args) {
  const id = args.experiment;
  if (!id) {
    console.error("Usage: flagpilot status --experiment <id> [--mock]");
    process.exitCode = 1;
    return;
  }
  const { backend, mode } = buildBackend(args);
  const results = await backend.getResults(Number(id));
  console.log(`Experiment ${id} — ${mode} mode`);
  if (results.variants) {
    for (const v of results.variants) {
      console.log(`  ${v.key.padEnd(14)} "${v.value}"  ${v.exposures} exposures, ${v.conversions} conversions (${v.conversion_rate}), win probability ${v.win_probability}`);
    }
  } else {
    console.log(JSON.stringify(results, null, 2));
  }
  if (results.note) console.log(`  (${results.note})`);
}

async function cmdDemo(args) {
  console.log("FlagPilot demo — checkout button A/B test, end to end.\n");
  const plan = parsePrompt(DEMO_PROMPT);
  const errors = validatePlan(plan);
  if (errors.length) throw new Error(`demo plan invalid: ${errors.join("; ")}`);
  mkdirSync(".flagpilot", { recursive: true });
  writeFileSync(DEFAULT_PLAN_PATH, JSON.stringify(plan, null, 2));
  console.log("Step 1 — plan drafted from prompt:");
  console.log(`  prompt: "${DEMO_PROMPT}"`);
  console.log(renderPlan(plan));
  console.log("\nStep 2 — human approval gate:");
  let approved = false;
  if (args.approve) {
    approved = true;
    console.log("  [HUMAN APPROVAL RECORDED — --approve flag]");
  } else if (process.stdin.isTTY) {
    approved = await askApproval("  Apply this demo plan? [y/N] ");
  } else {
    console.error("  REFUSED: demo needs --approve in non-interactive runs.");
    process.exitCode = 1;
    return;
  }
  if (!approved) {
    console.log("  Not approved — demo stopped, nothing created.");
    return;
  }
  const { backend, mode } = buildBackend(args);
  console.log(`\nStep 3 — creating in Flagsmith (${mode} mode)…`);
  const { featureId, variantIds } = await backend.createFeature(plan);
  const metricId = await backend.createMetric(plan);
  const experimentId = await backend.createExperiment(plan, featureId, metricId, variantIds);
  const status = await backend.startExperiment(experimentId);
  console.log(renderResult(plan, {
    featureId, metricId, experimentId,
    experimentName: `${plan.title} — ${plan.flag}`,
    status,
    dashboardUrl: backend.dashboardExperimentUrl(experimentId),
  }));
  console.log("\nStep 4 — results (simulated traffic in mock mode):");
  const results = await backend.getResults(experimentId);
  for (const v of results.variants) {
    console.log(`  ${v.key.padEnd(14)} "${v.value}"  ${v.exposures} exposures, ${v.conversions} conversions (${v.conversion_rate}), win probability ${v.win_probability}`);
  }
  console.log("\nDemo complete. Run it yourself: node flagpilot.mjs demo --mock --approve");
}

async function cmdProjects(args) {
  const { backend, mode } = buildBackend(args);
  if (mode === "mock") {
    console.log("Mock mode — one demo project:");
    console.log("  id 1  FlagPilot Demo Project  (environment key: mock-env)");
    return;
  }
  const data = await backend.requestWithAuthFallback("/projects/");
  const list = Array.isArray(data) ? data : data.results || [];
  for (const p of list) console.log(`  id ${p.id}  ${p.name}`);
  if (!list.length) console.log("  (no projects found — create one in the Flagsmith dashboard first)");
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  try {
    switch (cmd) {
      case "plan": await cmdPlan(args); break;
      case "apply": await cmdApply(args); break;
      case "status": await cmdStatus(args); break;
      case "demo": await cmdDemo(args); break;
      case "projects": await cmdProjects(args); break;
      case "--help": case "-h": case undefined: usage(); break;
      default:
        console.error(`Unknown command: ${cmd}`);
        usage();
        process.exitCode = 1;
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
}

main();
