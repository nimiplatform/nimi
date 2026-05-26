import { describe, it, expect, vi } from 'vitest';

vi.mock('@nimiplatform/sdk', () => ({
  getPlatformClient: () => ({ realm: { services: {} } }),
}));

const adc = await import('./analytics-data-client.js');

describe('analytics-data-client', () => {
  const message = 'Analytics is deferred in the current Forge scope';

  it('getAnalyticsOverview throws', async () => {
    await expect(adc.getAnalyticsOverview()).rejects.toThrow(message);
  });

  it('getAnalyticsFunnel throws', async () => {
    await expect(adc.getAnalyticsFunnel()).rejects.toThrow(message);
  });

  it('getAnalyticsRetention throws', async () => {
    await expect(adc.getAnalyticsRetention()).rejects.toThrow(message);
  });

  it('getAnalyticsHeatmap throws', async () => {
    await expect(adc.getAnalyticsHeatmap()).rejects.toThrow(message);
  });
});
