// Rule-based prompt parser: feature request -> experiment plan.
// Deterministic, offline, zero dependencies. No guessing: every field in the
// plan is either extracted from the prompt or a clearly-marked default.

const STOPWORDS = new Set([
  "test", "try", "trying", "compare", "comparing", "a/b", "ab", "experiment",
  "run", "check", "see", "whether", "if", "the", "a", "an", "on", "in", "for",
  "of", "to", "my", "our", "with", "and", "or", "please", "help", "me", "i",
  "want", "lets", "let's", "should", "we", "which", "better", "version",
  "versions", "variant", "variants", "copy",
]);

const METRICS = [
  { re: /purchas|checkout|buy now|complete (the )?purchase|order/i, metric: "Purchase", event: "purchase_completed" },
  { re: /sign ?up|sign-up|register|registration|create (an )?account/i, metric: "Sign-up", event: "signup_completed" },
  { re: /subscri|pricing|plan (first|page)|upgrade/i, metric: "Subscription", event: "subscription_started" },
  { re: /click|cta|call to action/i, metric: "Click-through", event: "cta_clicked" },
  { re: /onboard|setup quiz|first (screen|run)|empty state/i, metric: "Onboarding completion", event: "onboarding_completed" },
];

function slugify(words) {
  return words
    .join("_")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "feature_test";
}

function extractQuoted(prompt) {
  const out = [];
  const re = /["']([^"']{1,80})["']/g;
  let m;
  while ((m = re.exec(prompt)) !== null) out.push(m[1].trim());
  return out;
}

function extractVs(prompt) {
  const m = prompt.match(/([\w][\w' -]{1,60}?)\s+vs\.?\s+([\w][\w' -]{1,60}?)(?:[.,;]|$)/i);
  if (!m) return null;
  return [m[1].trim(), m[2].trim()];
}

function extractSplit(prompt) {
  const m = prompt.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a + b !== 100 || a < 5 || b < 5) return null;
  return [a, b];
}

function guessWhat(prompt, excluded = new Set()) {
  // Only the descriptive part before the variants: cut at the first quoted
  // string or " vs " — everything after that is variant values, not the "what".
  // Words that appear inside a variant value are also excluded.
  let head = prompt.split(/["']/)[0];
  const vsIdx = head.search(/\s+vs\.?\s+/i);
  if (vsIdx >= 0) head = head.slice(0, vsIdx);
  const first = head.split(/[.!?\n]/)[0];
  const words = first
    .replace(/["']/g, " ")
    .split(/[^a-zA-Z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w.toLowerCase()) && !excluded.has(w.toLowerCase()));
  return words.slice(0, 4);
}

export function parsePrompt(prompt) {
  if (!prompt || !prompt.trim()) {
    throw new Error("Empty prompt — paste a feature request, e.g. \"Test the copy on the checkout button: 'Buy now' vs 'Complete purchase', success is a completed purchase.\"");
  }
  const text = prompt.trim();

  // 1. Variants: quoted strings first, then "X vs Y".
  let variants = extractQuoted(text);
  if (variants.length === 0) {
    const vs = extractVs(text);
    if (vs) variants = vs;
  }
  if (variants.length === 0) variants = ["current", "new"];
  if (variants.length === 1) variants = [variants[0], "new"];
  const [controlValue, ...challengers] = variants;

  // 2. Metric from keywords.
  let metric = { name: "Conversion", event: "conversion" };
  for (const cand of METRICS) {
    if (cand.re.test(text)) {
      metric = { name: cand.metric, event: cand.event };
      break;
    }
  }

  // 3. Split.
  const split = extractSplit(text) || [50, 50];

  // 4. Flag name + title from the "what" (variant words excluded).
  const excluded = new Set(
    variants.flatMap((v) => v.toLowerCase().split(/[^a-z0-9]+/)),
  );
  const whatWords = guessWhat(text, excluded);
  const what = whatWords.join(" ") || "feature";
  const flag = slugify(whatWords);
  const title = whatWords.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") || "Feature test";

  // 5. Hypothesis.
  const challengerText = challengers.join(" / ");
  const hypothesis =
    `Changing ${what} from "${controlValue}" to "${challengerText}" will increase ${metric.name.toLowerCase()} ` +
    `(measured by event "${metric.event}").`;

  const plan = {
    version: 1,
    flag,
    title,
    hypothesis,
    variants: [
      { key: "control", value: controlValue, allocation: split[0] },
      ...challengers.map((value, i) => ({
        key: `challenger_${i + 1}`,
        value,
        allocation: Math.round(split[1] / challengers.length),
      })),
    ],
    metric: {
      name: metric.name,
      event: metric.event,
      aggregation: "occurrence",
      direction: "up",
    },
    rollout_percentage: 100,
    source_prompt: text,
  };

  // Fix rounding so allocations sum to 100.
  const total = plan.variants.reduce((s, v) => s + v.allocation, 0);
  if (total !== 100) plan.variants[plan.variants.length - 1].allocation += 100 - total;
  return plan;
}
