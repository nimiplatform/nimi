/**
 * Analytics Data Client — Forge adapter (FG-ANALYTICS-001..004)
 *
 * Creator analytics: overview, funnel, retention, and heatmap.
 * Analytics is deferred from the current Forge scope.
 */

import { getPlatformClient } from '@runtime/platform-client.js';

function realm() {
  return getPlatformClient().realm;
}

// ── Creator Analytics ───────────────────────────────────────

export async function getAnalyticsOverview(_params?: Record<string, unknown>): Promise<unknown> {
  throw new Error('Analytics is deferred in the current Forge scope');
}

export async function getAnalyticsFunnel(_params?: Record<string, unknown>): Promise<unknown> {
  throw new Error('Analytics is deferred in the current Forge scope');
}

export async function getAnalyticsRetention(_params?: Record<string, unknown>): Promise<unknown> {
  throw new Error('Analytics is deferred in the current Forge scope');
}

export async function getAnalyticsHeatmap(_params?: Record<string, unknown>): Promise<unknown> {
  throw new Error('Analytics is deferred in the current Forge scope');
}
