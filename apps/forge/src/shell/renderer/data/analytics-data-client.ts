/**
 * Analytics Data Client — Forge adapter (FG-ANALYTICS-001..004)
 *
 * Creator analytics: overview, funnel, retention, and heatmap.
 * Analytics is deferred from the current Forge scope.
 */

import { throwDeferredFeature } from './deferred-feature.js';

export type ForgeAnalyticsQuery = {
  from?: string;
  to?: string;
  worldId?: string;
  agentId?: string;
};

export type ForgeAnalyticsOverview = never;
export type ForgeAnalyticsFunnel = never;
export type ForgeAnalyticsRetention = never;
export type ForgeAnalyticsHeatmap = never;

export async function getAnalyticsOverview(_params?: ForgeAnalyticsQuery): Promise<ForgeAnalyticsOverview> {
  return throwDeferredFeature('analytics', 'Analytics is deferred in the current Forge scope');
}

export async function getAnalyticsFunnel(_params?: ForgeAnalyticsQuery): Promise<ForgeAnalyticsFunnel> {
  return throwDeferredFeature('analytics', 'Analytics is deferred in the current Forge scope');
}

export async function getAnalyticsRetention(_params?: ForgeAnalyticsQuery): Promise<ForgeAnalyticsRetention> {
  return throwDeferredFeature('analytics', 'Analytics is deferred in the current Forge scope');
}

export async function getAnalyticsHeatmap(_params?: ForgeAnalyticsQuery): Promise<ForgeAnalyticsHeatmap> {
  return throwDeferredFeature('analytics', 'Analytics is deferred in the current Forge scope');
}
