// Mock Flagsmith backend — same interface as FlagsmithClient, zero network.
// Lets judges run the full flow (plan -> approve -> apply -> start -> status)
// with no credentials. State persists to .flagpilot/mock-state.json so
// repeated runs see the same flags/experiments. Results are deterministic:
// seeded from the flag name, so the same demo always shows the same numbers.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

function seedFrom(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export class MockFlagsmith {
  constructor({ statePath }) {
    this.statePath = statePath || ".flagpilot/mock-state.json";
    this.state = { nextId: 1000, features: [], metrics: [], experiments: [] };
    if (existsSync(this.statePath)) {
      try {
        this.state = JSON.parse(readFileSync(this.statePath, "utf8"));
      } catch { /* corrupted state: start fresh */ }
    }
  }

  save() {
    mkdirSync(dirname(this.statePath), { recursive: true });
    writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
  }

  next() {
    return this.state.nextId++;
  }

  async checkWarehouse() {
    return true; // mock Cloud always has a warehouse
  }

  async createFeature(plan) {
    const featureId = this.next();
    const variantIds = {};
    for (const v of plan.variants) {
      if (v.key === "control") continue;
      variantIds[v.key] = this.next();
    }
    this.state.features.push({ id: featureId, name: plan.flag, variantIds });
    this.save();
    return { featureId, variantIds, feature: { id: featureId, name: plan.flag } };
  }

  async createMetric(plan) {
    const metricId = this.next();
    this.state.metrics.push({ id: metricId, name: plan.metric.name, event: plan.metric.event });
    this.save();
    return metricId;
  }

  async createExperiment(plan, featureId, metricId) {
    const experimentId = this.next();
    const seed = seedFrom(plan.flag);
    // Deterministic simulated traffic: challenger wins narrowly in the demo.
    const controlConv = 4.0 + (seed % 20) / 10; // 4.0-5.9%
    const chalConv = controlConv + 0.6 + ((seed >> 3) % 10) / 10; // +0.6-1.5pp
    this.state.experiments.push({
      id: experimentId,
      name: `${plan.title} — ${plan.flag}`,
      hypothesis: plan.hypothesis,
      featureId,
      metricId,
      status: "draft",
      variants: plan.variants.map((v) => ({
        key: v.key,
        value: v.value,
        allocation: v.allocation,
        exposures: 1000 + (seed % 500),
        conversions: Math.round((1000 + (seed % 500)) * (v.key === "control" ? controlConv : chalConv) / 100),
      })),
      winProbability: { control: 8, challenger_1: 92 },
    });
    this.save();
    return experimentId;
  }

  async startExperiment(experimentId) {
    const exp = this.state.experiments.find((e) => e.id === experimentId);
    if (!exp) throw new Error(`mock: experiment ${experimentId} not found`);
    exp.status = "running";
    this.save();
    return "running";
  }

  async getResults(experimentId) {
    const exp = this.state.experiments.find((e) => e.id === experimentId);
    if (!exp) throw new Error(`mock: experiment ${experimentId} not found`);
    return {
      experiment: exp.id,
      status: exp.status,
      variants: exp.variants.map((v) => ({
        key: v.key,
        value: v.value,
        exposures: v.exposures,
        conversions: v.conversions,
        conversion_rate: `${((v.conversions / v.exposures) * 100).toFixed(1)}%`,
        win_probability: `${exp.winProbability[v.key] ?? 0}%`,
      })),
      note: "mock results — simulated traffic, deterministic per flag name",
    };
  }

  dashboardExperimentUrl(experimentId) {
    return `mock://dashboard/project/mock/environment/mock/experiments/${experimentId}`;
  }
}
