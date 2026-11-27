// Plan validation + human-readable rendering.
// The plan is the artefact the human approves. Nothing vague: every line the
// user sees is exactly what will be created in Flagsmith.

export function validatePlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== "object") return ["plan is not an object"];
  if (!/^[a-z][a-z0-9_]{2,60}$/.test(plan.flag || "")) {
    errors.push(`flag name "${plan.flag}" must be snake_case, 3-60 chars`);
  }
  if (!Array.isArray(plan.variants) || plan.variants.length < 2) {
    errors.push("need at least 2 variants (control + challenger)");
  } else {
    const keys = new Set();
    for (const v of plan.variants) {
      if (!v.key || keys.has(v.key)) errors.push(`duplicate/missing variant key: ${v.key}`);
      keys.add(v.key);
      if (typeof v.value !== "string" || v.value.length === 0) errors.push(`variant ${v.key} has no value`);
      if (!Number.isInteger(v.allocation) || v.allocation < 1 || v.allocation > 99) {
        errors.push(`variant ${v.key} allocation ${v.allocation} must be 1-99`);
      }
    }
    const total = plan.variants.reduce((s, v) => s + v.allocation, 0);
    if (total !== 100) errors.push(`allocations sum to ${total}, must be 100`);
    if (plan.variants[0].key !== "control") errors.push('first variant must be "control"');
  }
  if (!plan.metric || !/^[a-z][a-z0-9_]{2,60}$/.test(plan.metric.event || "")) {
    errors.push(`metric event "${plan.metric && plan.metric.event}" must be snake_case`);
  }
  if (!plan.hypothesis || plan.hypothesis.length < 10) errors.push("hypothesis is missing or too short");
  return errors;
}

export function renderPlan(plan) {
  const lines = [];
  lines.push(`Flag:        ${plan.flag}  (${plan.title})`);
  lines.push(`Hypothesis:  ${plan.hypothesis}`);
  lines.push(`Variants:`);
  for (const v of plan.variants) {
    lines.push(`  - ${v.key.padEnd(14)} "${v.value}"  — ${v.allocation}% of traffic`);
  }
  lines.push(`Metric:      ${plan.metric.name}  (event "${plan.metric.event}", ${plan.metric.aggregation}, direction ${plan.metric.direction})`);
  lines.push(`Rollout:     ${plan.rollout_percentage}% of users enter the experiment`);
  lines.push(`Source:      ${plan.source_prompt.slice(0, 120)}${plan.source_prompt.length > 120 ? "…" : ""}`);
  return lines.join("\n");
}

export function renderResult(plan, created) {
  const lines = [];
  lines.push(`Experiment created in Flagsmith`);
  lines.push(`  Flag:        ${plan.flag}  (id ${created.featureId})`);
  lines.push(`  Metric:      ${plan.metric.name}  (id ${created.metricId}, event "${plan.metric.event}")`);
  lines.push(`  Experiment:  ${created.experimentName}  (id ${created.experimentId}, status ${created.status})`);
  lines.push(`  Variants:    ${plan.variants.map((v) => `${v.key}=${v.allocation}%`).join(", ")}`);
  lines.push(`  Dashboard:   ${created.dashboardUrl}`);
  lines.push(`  Next:        send traffic (SDK events), then "flagpilot status --experiment ${created.experimentId}"`);
  return lines.join("\n");
}
