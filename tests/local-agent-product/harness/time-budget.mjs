export function resolveProductJourneyTimeBudgetMs(env = process.env, fallbackMs) {
  const raw = String(env.NIMI_LOCAL_AGENT_PRODUCT_JOURNEY_TIME_BUDGET_MS || '').trim();
  if (!raw) {
    if (!Number.isSafeInteger(fallbackMs) || fallbackMs <= 0) {
      throw new Error('local-agent product Journey time budget is required');
    }
    return fallbackMs;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('NIMI_LOCAL_AGENT_PRODUCT_JOURNEY_TIME_BUDGET_MS must be a positive safe integer');
  }
  return value;
}
