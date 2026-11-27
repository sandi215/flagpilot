// Real Flagsmith REST client (Flagsmith Cloud, api.flagsmith.com).
//
// Endpoints + bodies follow the official docs:
//  - Feature + variants: docs.flagsmith.com "Set Up an Experiment with a
//    Coding Agent" — `flagsmith feature create <flag> --value control
//    --enabled`, then `feature variant add` per variation (every variation
//    needs a key; "control" is reserved for the flag's own value).
//    REST equivalents: POST /api/v1/projects/{pk}/features/ and
//    POST /api/v1/projects/{pk}/features/{feature_pk}/mv-options/
//  - Metric + experiment + start + results: same doc page.
//    POST /api/v1/environments/{envKey}/experiment-metrics/
//    POST /api/v1/environments/{envKey}/experiments/
//    POST /api/v1/environments/{envKey}/experiments/{id}/start/
//    GET  /api/v1/environments/{envKey}/experiments/{id}/results/
//  - Warehouse gate: GET /api/v1/environments/{envKey}/warehouse-connections/
//    must return at least one connection, otherwise experiments cannot run
//    (docs: send the user to connect-a-warehouse).
//
// Auth: the classic management API uses `Authorization: Token <key>`.
// If a Cloud key answers 401, retry once with `Api-Key <key>` (the scheme
// the hosted MCP server documents) and report which one worked.
// Nothing here is guessed from thin air: payload shapes are the ones in the
// docs above; they get confirmed live on the first real demo run.

const DEFAULT_BASE = "https://api.flagsmith.com/api/v1";
const DEFAULT_DASHBOARD = "https://app.flagsmith.com";

export class FlagsmithClient {
  constructor({ apiKey, projectId, environmentKey, baseUrl, dashboardUrl, fetchImpl }) {
    if (!apiKey) throw new Error("FLAGSMITH_API_KEY is required for real mode (or run with --mock)");
    if (!projectId) throw new Error("FLAGSMITH_PROJECT_ID is required for real mode");
    if (!environmentKey) throw new Error("FLAGSMITH_ENVIRONMENT_KEY is required for real mode");
    this.apiKey = apiKey;
    this.projectId = projectId;
    this.environmentKey = environmentKey;
    this.baseUrl = (baseUrl || DEFAULT_BASE).replace(/\/$/, "");
    this.dashboardUrl = (dashboardUrl || DEFAULT_DASHBOARD).replace(/\/$/, "");
    this.fetch = fetchImpl || globalThis.fetch;
    this.authScheme = process.env.FLAGSMITH_AUTH_SCHEME || "Token";
  }

  async request(path, { method = "GET", body = null } = {}) {
    const url = `${this.baseUrl}${path}`;
    const res = await this.fetch(url, {
      method,
      headers: {
        Authorization: `${this.authScheme} ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
    if (!res.ok) {
      const detail = (data && (data.detail || data.message)) || text.slice(0, 200);
      const err = new Error(`Flagsmith API ${method} ${path} -> HTTP ${res.status}: ${detail}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // If the first call 401s under "Token", retry the same call under "Api-Key".
  async requestWithAuthFallback(path, opts) {
    try {
      return await this.request(path, opts);
    } catch (err) {
      if (err.status === 401 && this.authScheme === "Token") {
        this.authScheme = "Api-Key";
        console.error("  (note: Token auth rejected, retrying with Api-Key scheme)");
        return await this.request(path, opts);
      }
      throw err;
    }
  }

  async checkWarehouse() {
    const data = await this.requestWithAuthFallback(
      `/environments/${encodeURIComponent(this.environmentKey)}/warehouse-connections/`,
    );
    const list = Array.isArray(data) ? data : data.results || [];
    return list.length > 0;
  }

  async createFeature(plan) {
    const feature = await this.requestWithAuthFallback(
      `/projects/${this.projectId}/features/`,
      {
        method: "POST",
        body: {
          name: plan.flag,
          description: plan.hypothesis,
          default_enabled: true,
          initial_value: "control",
          type: "MULTIVARIATE",
        },
      },
    );
    const featureId = feature.id;
    const variantIds = {};
    for (const v of plan.variants) {
      if (v.key === "control") continue; // control is the flag's own value
      const opt = await this.requestWithAuthFallback(
        `/projects/${this.projectId}/features/${featureId}/mv-options/`,
        {
          method: "POST",
          body: {
            type: "unicode",
            string_value: v.value,
            default_percentage_allocation: v.allocation,
          },
        },
      );
      variantIds[v.key] = opt.id;
    }
    // Re-read the feature to get the canonical variant ids (incl. control slot).
    const full = await this.requestWithAuthFallback(`/projects/${this.projectId}/features/${featureId}/`);
    return { featureId, variantIds, feature: full };
  }

  async createMetric(plan) {
    const metric = await this.requestWithAuthFallback(
      `/environments/${encodeURIComponent(this.environmentKey)}/experiment-metrics/`,
      {
        method: "POST",
        body: {
          name: plan.metric.name,
          aggregation: plan.metric.aggregation || "occurrence",
          direction: plan.metric.direction || "up",
          definition: { version: 1, event: plan.metric.event },
        },
      },
    );
    return metric.id;
  }

  async createExperiment(plan, featureId, metricId, variantIds) {
    const mvValues = plan.variants
      .filter((v) => v.key !== "control" && variantIds[v.key] != null)
      .map((v) => ({
        multivariate_feature_option: variantIds[v.key],
        percentage_allocation: v.allocation,
      }));
    const experiment = await this.requestWithAuthFallback(
      `/environments/${encodeURIComponent(this.environmentKey)}/experiments/`,
      {
        method: "POST",
        body: {
          feature: featureId,
          name: `${plan.title} — ${plan.flag}`,
          hypothesis: plan.hypothesis,
          metrics: [{ metric: metricId, expected_direction: "increase" }],
          experiment_rollout: {
            enabled: true,
            rollout_percentage: plan.rollout_percentage || 100,
            feature_state_value: { type: "string", value: "control" },
            multivariate_feature_state_values: mvValues,
          },
        },
      },
    );
    return experiment.id;
  }

  async startExperiment(experimentId) {
    await this.requestWithAuthFallback(
      `/environments/${encodeURIComponent(this.environmentKey)}/experiments/${experimentId}/start/`,
      { method: "POST" },
    );
    return "running";
  }

  async getResults(experimentId) {
    return this.requestWithAuthFallback(
      `/environments/${encodeURIComponent(this.environmentKey)}/experiments/${experimentId}/results/`,
    );
  }

  dashboardExperimentUrl(experimentId) {
    return `${this.dashboardUrl}/project/${this.projectId}/environment/${encodeURIComponent(this.environmentKey)}/experiments/${experimentId}`;
  }
}
