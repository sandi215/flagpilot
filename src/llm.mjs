// Optional LLM parsing via Gemini free tier (custom.gemini connector).
// The rule-based parser is the default; this only runs with --llm gemini.
// Calls the connector helper (never touches a raw API key). Any failure
// (timeout, bad JSON, no helper) falls back to the rule-based parser — the
// CLI never blocks on the LLM.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const HELPER = "/home/hatch/workspace/custom-connectors/custom.gemini/bin/client.py";
const MODEL = "gemini-3.8-flash";

export async function parseWithGemini(prompt, { timeoutMs = 150000 } = {}) {
  const instruction = [
    "You are FlagPilot's plan extractor. Turn the feature request below into a JSON experiment plan.",
    "Return ONLY a JSON object, no markdown, no explanation, with exactly these keys:",
    '{"flag": "snake_case_flag_name", "title": "Short Title", "hypothesis": "one sentence",',
    '"variants": [{"key": "control", "value": "current version", "allocation": 50}, {"key": "challenger_1", "value": "new version", "allocation": 50}],',
    '"metric": {"name": "Purchase", "event": "purchase_completed", "aggregation": "occurrence", "direction": "up"},',
    '"rollout_percentage": 100}',
    "Rules: flag is snake_case 3-60 chars; first variant key must be 'control'; allocations are integers summing to 100;",
    "metric event is snake_case; pick the event from the request (purchase_completed, signup_completed, subscription_started, cta_clicked, onboarding_completed, or conversion).",
    "",
    `Feature request: ${prompt}`,
  ].join("\n");

  const { stdout } = await execFileAsync(
    "python3",
    [HELPER, "generate", instruction, MODEL],
    { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
  );
  const jsonText = stdout.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "");
  const plan = JSON.parse(jsonText);
  plan.version = 1;
  plan.source_prompt = prompt;
  return plan;
}
