import { P4HarnessError } from './p4-errors.mjs';

const ALLOWED_DRIVER_GATES = new Set(['first-run', 'direct-nimi', 'partner-core']);
const BUDGET_ENV_NAME = 'NIMI_LOCAL_AGENT_PRODUCT_JOURNEY_TIME_BUDGET_MS';

function manifestFailure(message) {
  throw new P4HarnessError('P4_MANIFEST_INVALID', message);
}

function positiveBudget(value, label) {
  const budget = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(budget) || budget <= 0) {
    manifestFailure(`${label} must be a positive safe integer`);
  }
  return budget;
}

export function parseP4Manifest(executionPolicy, journeyRegistry, shellEnv = {}) {
  const selectedIds = executionPolicy?.gates?.first_party_p4?.journeys;
  if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
    manifestFailure('execution policy declares no first_party_p4 journeys');
  }

  const policyIds = new Set();
  for (const rawId of selectedIds) {
    const journeyId = String(rawId || '').trim();
    if (!journeyId) manifestFailure('execution policy contains an empty first_party_p4 journey ID');
    if (policyIds.has(journeyId)) manifestFailure(`execution policy contains duplicate journey ID: ${journeyId}`);
    policyIds.add(journeyId);
  }

  const registryEntries = journeyRegistry?.journeys;
  if (!Array.isArray(registryEntries)) manifestFailure('journey registry must declare a journeys array');
  const registry = new Map();
  for (const entry of registryEntries) {
    const journeyId = String(entry?.journey_id || '').trim();
    if (!journeyId) manifestFailure('journey registry contains an empty journey ID');
    if (registry.has(journeyId)) manifestFailure(`journey registry contains duplicate journey ID: ${journeyId}`);
    registry.set(journeyId, entry);
  }

  const hasBudgetOverride = Object.hasOwn(shellEnv, BUDGET_ENV_NAME);
  const effectiveOverride = hasBudgetOverride
    ? positiveBudget(shellEnv[BUDGET_ENV_NAME], BUDGET_ENV_NAME)
    : null;
  const selectedGates = new Set();

  return Object.freeze(selectedIds.map((rawId, index) => {
    const journeyId = String(rawId).trim();
    const journey = registry.get(journeyId);
    if (!journey) manifestFailure(`journey ${journeyId} is declared by the execution policy but absent from the journey registry`);
    const gate = String(journey.driver_gate || '').trim();
    if (!ALLOWED_DRIVER_GATES.has(gate)) {
      manifestFailure(`journey ${journeyId} declares unsupported P4 driver_gate: ${gate || '<empty>'}`);
    }
    if (selectedGates.has(gate)) manifestFailure(`P4 selected sequence contains duplicate driver_gate: ${gate}`);
    selectedGates.add(gate);
    const manifestBudgetMs = positiveBudget(journey.time_budget_ms, `journey ${journeyId} time_budget_ms`);
    const gateNumber = String(journey.product_gate || '').replace(/^gate_/u, '');
    return Object.freeze({
      gate,
      label: `Gate ${gateNumber || index}`,
      journeyId,
      manifestBudgetMs,
      effectiveBudgetMs: effectiveOverride ?? manifestBudgetMs,
      budgetSource: hasBudgetOverride ? 'environment' : 'manifest',
    });
  }));
}
