import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockEconomyService = {
  economyControllerGetBalances: vi.fn(),
  economyControllerGetSparkHistory: vi.fn(),
  economyControllerGetGemHistory: vi.fn(),
  economyControllerGetRevenueShareConfig: vi.fn(),
  economyControllerGetAgentOrigin: vi.fn(),
  economyControllerPreviewRevenueDistribution: vi.fn(),
  economyControllerGetConnectStatus: vi.fn(),
  economyControllerCreateConnectOnboarding: vi.fn(),
  economyControllerCreateConnectDashboard: vi.fn(),
  economyControllerGetWithdrawalConfig: vi.fn(),
  economyControllerCanWithdraw: vi.fn(),
  economyControllerCalculateWithdrawal: vi.fn(),
  economyControllerCreateWithdrawal: vi.fn(),
  economyControllerGetWithdrawalHistory: vi.fn(),
  economyControllerGetWithdrawal: vi.fn(),
};

vi.mock('@runtime/platform-client.js', () => ({
  getPlatformClient: () => ({
    realm: {
      services: { EconomyCurrencyGiftsService: mockEconomyService },
    },
  }),
}));

const rdc = await import('./revenue-data-client.js');

describe('revenue-data-client', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('getBalances', async () => {
    mockEconomyService.economyControllerGetBalances.mockResolvedValue({ spark: 100 });
    const result = await rdc.getBalances();
    expect(result).toEqual({ spark: 100 });
  });

  it('getSparkHistory', async () => {
    await rdc.getSparkHistory();
    expect(mockEconomyService.economyControllerGetSparkHistory).toHaveBeenCalledOnce();
  });

  it('getGemHistory', async () => {
    await rdc.getGemHistory();
    expect(mockEconomyService.economyControllerGetGemHistory).toHaveBeenCalledOnce();
  });

  it('getRevenueShareConfig', async () => {
    await rdc.getRevenueShareConfig();
    expect(mockEconomyService.economyControllerGetRevenueShareConfig).toHaveBeenCalledOnce();
  });

  it('getAgentOrigin passes agentId', async () => {
    await rdc.getAgentOrigin('a1');
    expect(mockEconomyService.economyControllerGetAgentOrigin).toHaveBeenCalledWith('a1');
  });

  it('previewRevenueDistribution passes amount and agentId', async () => {
    await rdc.previewRevenueDistribution('100', 'a1');
    expect(mockEconomyService.economyControllerPreviewRevenueDistribution).toHaveBeenCalledWith('100', 'a1');
  });

  it('getConnectStatus', async () => {
    await rdc.getConnectStatus();
    expect(mockEconomyService.economyControllerGetConnectStatus).toHaveBeenCalledOnce();
  });

  it('createConnectOnboarding passes payload', async () => {
    await rdc.createConnectOnboarding({ returnUrl: '/done' });
    expect(mockEconomyService.economyControllerCreateConnectOnboarding).toHaveBeenCalledWith({ returnUrl: '/done' });
  });

  it('createConnectDashboard', async () => {
    await rdc.createConnectDashboard();
    expect(mockEconomyService.economyControllerCreateConnectDashboard).toHaveBeenCalledOnce();
  });

  it('getWithdrawalConfig', async () => {
    await rdc.getWithdrawalConfig();
    expect(mockEconomyService.economyControllerGetWithdrawalConfig).toHaveBeenCalledOnce();
  });

  it('canWithdraw', async () => {
    await rdc.canWithdraw();
    expect(mockEconomyService.economyControllerCanWithdraw).toHaveBeenCalledOnce();
  });

  it('calculateWithdrawal passes amount', async () => {
    await rdc.calculateWithdrawal('50');
    expect(mockEconomyService.economyControllerCalculateWithdrawal).toHaveBeenCalledWith('50');
  });

  it('createWithdrawal passes payload', async () => {
    await rdc.createWithdrawal({ amount: '50' });
    expect(mockEconomyService.economyControllerCreateWithdrawal).toHaveBeenCalledWith({ amount: '50' });
  });

  it('getWithdrawalHistory', async () => {
    await rdc.getWithdrawalHistory();
    expect(mockEconomyService.economyControllerGetWithdrawalHistory).toHaveBeenCalledOnce();
  });

  it('getWithdrawal passes id', async () => {
    await rdc.getWithdrawal('w1');
    expect(mockEconomyService.economyControllerGetWithdrawal).toHaveBeenCalledWith('w1');
  });
});
