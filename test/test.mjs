// FlagPilot tests — zero deps, node:test.
// Run: npm test   (or: node --test test/test.mjs)

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePrompt } from "../src/parser.mjs";
import { validatePlan } from "../src/plan.mjs";
import { MockFlagsmith } from "../src/mock.mjs";

const execFileAsync = promisify(execFile);
const CLI = new URL("../flagpilot.mjs", import.meta.url).pathname;

test("parser: checkout button prompt -> control/challenger + purchase metric", () => {
  const plan = parsePrompt(
    "Test the copy on the checkout button: 'Buy now' vs 'Complete purchase', success is a completed purchase.",
  );
  assert.equal(plan.flag, "checkout_button");
  assert.equal(plan.variants[0].key, "control");
  assert.equal(plan.variants[0].value, "Buy now");
  assert.equal(plan.variants[1].value, "Complete purchase");
  assert.equal(plan.variants[0].allocation + plan.variants[1].allocation, 100);
  assert.equal(plan.metric.event, "purchase_completed");
  assert.deepEqual(validatePlan(plan), []);
});

test("parser: signup form prompt -> signup metric, 70/30 split", () => {
  const plan = parsePrompt(
    "Compare the signup form: three-field vs six-field, 70/30 split, success is a new signup.",
  );
  assert.equal(plan.metric.event, "signup_completed");
  assert.equal(plan.variants[0].allocation, 70);
  assert.equal(plan.variants[1].allocation, 30);
  assert.deepEqual(validatePlan(plan), []);
});

test("parser: prompt without variants -> sensible defaults", () => {
  const plan = parsePrompt("Test the new onboarding flow");
  assert.equal(plan.variants.length, 2);
  assert.equal(plan.variants[0].key, "control");
  assert.deepEqual(validatePlan(plan), []);
});

test("validator: allocations must sum to 100", () => {
  const plan = parsePrompt("Test the checkout button: 'A' vs 'B'");
  plan.variants[1].allocation = 40;
  const errors = validatePlan(plan);
  assert.ok(errors.some((e) => e.includes("sum to 90")));
});

test("mock: full flow plan -> apply -> start -> results", async () => {
  const mock = new MockFlagsmith({ statePath: join(mkdtempSync(join(tmpdir(), "flagpilot-mock-")), "mock-state.json") });
  const plan = parsePrompt("Test the checkout button: 'Buy now' vs 'Complete purchase'");
  assert.equal(await mock.checkWarehouse(), true);
  const { featureId, variantIds } = await mock.createFeature(plan);
  const metricId = await mock.createMetric(plan);
  const expId = await mock.createExperiment(plan, featureId, metricId, variantIds);
  const status = await mock.startExperiment(expId);
  assert.equal(status, "running");
  const results = await mock.getResults(expId);
  assert.equal(results.variants.length, 2);
  assert.ok(results.variants.every((v) => v.exposures > 0 && v.conversions >= 0));
});

test("cli: demo --mock --approve runs end to end", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flagpilot-demo-"));
  const { stdout } = await execFileAsync("node", [CLI, "demo", "--mock", "--approve"], { cwd: dir });
  assert.match(stdout, /Experiment created in Flagsmith/);
  assert.match(stdout, /HUMAN APPROVAL RECORDED/);
  assert.match(stdout, /win probability/);
  const plan = JSON.parse(readFileSync(join(dir, ".flagpilot/plan.json"), "utf8"));
  assert.equal(plan.flag, "checkout_button");
});

test("cli: apply without approval in non-TTY refuses", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flagpilot-refuse-"));
  writeFileSync(join(dir, ".flagpilot-plan.json"), JSON.stringify(parsePrompt("Test the checkout button: 'A' vs 'B'")));
  // plan file must exist at the path apply reads; use --plan explicitly
  const { stdout, stderr } = await execFileAsync(
    "node",
    [CLI, "apply", "--plan", join(dir, ".flagpilot-plan.json"), "--mock"],
    { cwd: dir },
  ).catch((e) => e);
  assert.match((stdout || "") + (stderr || ""), /REFUSED: no human approval/);
});

test("cli: plan + apply --approve --mock creates the experiment", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flagpilot-apply-"));
  await execFileAsync("node", [CLI, "plan", "Test the pricing page: 'Monthly first' vs 'Annual first', success is a subscription"], { cwd: dir });
  const { stdout } = await execFileAsync("node", [CLI, "apply", "--approve", "--mock"], { cwd: dir });
  assert.match(stdout, /Experiment created in Flagsmith/);
  assert.match(stdout, /subscription_started/);
});
