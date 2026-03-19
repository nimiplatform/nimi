/**
 * Forge Revenue Resource Queries (FG-REV-001..005)
 */

import { useQuery } from '@tanstack/react-query';
import {
  getBalances,
  getSparkHistory,
  getGemHistory,
  getRevenueShareConfig,
  previewRevenueDistribution,
  getConnectStatus,
  getWithdrawalConfig,
  canWithdraw,
  calculateWithdrawal,
  getWithdrawalHistory,
} from '@renderer/data/revenue-data-client.js';

type BalancesPayload = Awaited<ReturnType<typeof getBalances>>;
type SparkHistoryPayload = Awaited<ReturnType<typeof getSparkHistory>>;
type GemHistoryPayload = Awaited<ReturnType<typeof getGemHistory>>;
type RevenueShareConfigPayload = Awaited<ReturnType<typeof getRevenueShareConfig>>;
type RevenuePreviewPayload = Awaited<ReturnType<typeof previewRevenueDistribution>>;
type ConnectStatusPayload = Awaited<ReturnType<typeof getConnectStatus>>;
type WithdrawalConfigPayload = Awaited<ReturnType<typeof getWithdrawalConfig>>;
type CanWithdrawPayload = Awaited<ReturnType<typeof canWithdraw>>;
type WithdrawalCalculationPayload = Awaited<ReturnType<typeof calculateWithdrawal>>;
type WithdrawalHistoryPayload = Awaited<ReturnType<typeof getWithdrawalHistory>>;

// ── Types ────────────────────────────────────────────────────

export type BalanceData = {
  sparkBalance: number;
  gemBalance: number;
};

export type HistoryEntry = {
  id: string;
  type: string;
  amount: number;
  fromUserId: string | null;
  description: string;
  createdAt: string;
};

export type ConnectStatusData = {
  status: 'not_connected' | 'onboarding' | 'connected' | 'restricted';
};

export type RevenueShareConfigData = {
  creatorPercent: number;
  platformPercent: number;
  minimumThreshold: number;
};

export type RevenuePreviewData = RevenuePreviewPayload;

export type WithdrawalConfigData = {
  minimumAmount: number;
  feePercent: number;
  gemToUsdRate: number;
};

export type CanWithdrawData = {
  amount: number;
  canWithdraw: boolean;
  connectStatus: CanWithdrawPayload['connectStatus'];
  minimumAmount: number;
  reason: string | null;
};

export type WithdrawalCalculationData = {
  gemAmount: number;
  fee: number;
  netAmount: number;
  usdAmount: number;
};

export type WithdrawalEntry = {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
  completedAt: string | null;
};

// ── Normalizers ──────────────────────────────────────────────

function toBalanceData(payload: BalancesPayload): BalanceData {
  return {
    sparkBalance: Number(payload.sparkBalance ?? 0),
    gemBalance: Number(payload.gemBalance ?? 0),
  };
}

function toHistoryList(payload: SparkHistoryPayload | GemHistoryPayload): HistoryEntry[] {
  const items = Array.isArray(payload) ? payload : payload.items ?? [];
  return items.map((item) => {
    return {
      id: String(item.id || ''),
      type: String((('type' in item ? item.type : undefined) ?? ('transactionType' in item ? item.transactionType : undefined)) || ''),
      amount: Number(item.amount ?? 0),
      fromUserId: item.fromUserId ? String(item.fromUserId) : null,
      description: String((('description' in item ? item.description : undefined) ?? ('memo' in item ? item.memo : undefined)) || ''),
      createdAt: String(item.createdAt || ''),
    };
  }).filter((i) => Boolean(i.id));
}

function toWithdrawalList(payload: WithdrawalHistoryPayload): WithdrawalEntry[] {
  const items = Array.isArray(payload) ? payload : payload.items ?? [];
  return items.map((item) => {
    return {
      id: String(item.id || ''),
      amount: Number(item.amount ?? 0),
      status: String(item.status || ''),
      createdAt: String(item.createdAt || ''),
      completedAt: item.completedAt ? String(item.completedAt) : null,
    };
  }).filter((i) => Boolean(i.id));
}

function toRevenueShareConfigData(payload: RevenueShareConfigPayload): RevenueShareConfigData {
  const creatorPercent = Number(payload.nativeAgentCreatorSharePercent ?? 0);
  return {
    creatorPercent,
    platformPercent: Math.max(0, 100 - creatorPercent),
    minimumThreshold: Number(payload.minShareThreshold ?? 0),
  };
}

function toConnectStatusData(payload: ConnectStatusPayload): ConnectStatusData {
  switch (payload.status) {
    case 'VERIFIED':
      return { status: 'connected' };
    case 'PENDING':
      return { status: 'onboarding' };
    case 'RESTRICTED':
    case 'DISABLED':
      return { status: 'restricted' };
    default:
      return { status: 'not_connected' };
  }
}

function toWithdrawalConfigData(payload: WithdrawalConfigPayload): WithdrawalConfigData {
  return {
    minimumAmount: Number(payload.minGemAmount ?? 0),
    feePercent: Number(payload.feePercent ?? 0),
    gemToUsdRate: Number(payload.gemToUsdRate ?? 0),
  };
}

function toCanWithdrawData(payload: CanWithdrawPayload): CanWithdrawData {
  return {
    amount: Number(payload.balance ?? 0),
    canWithdraw: Boolean(payload.canWithdraw),
    connectStatus: payload.connectStatus,
    minimumAmount: Number(payload.minAmount ?? 0),
    reason: payload.reason ?? null,
  };
}

function toWithdrawalCalculationData(payload: WithdrawalCalculationPayload): WithdrawalCalculationData {
  return {
    gemAmount: Number(payload.gemAmount ?? 0),
    fee: Number(payload.feeAmount ?? 0),
    netAmount: Number(payload.netAmount ?? 0),
    usdAmount: Number(payload.usdAmount ?? 0),
  };
}

// ── Hooks ────────────────────────────────────────────────────

export function useBalancesQuery(enabled = true) {
  return useQuery({
    queryKey: ['forge', 'revenue', 'balances'],
    enabled,
    retry: false,
    queryFn: async () => toBalanceData(await getBalances()),
  });
}

export function useSparkHistoryQuery(enabled = true) {
  return useQuery({
    queryKey: ['forge', 'revenue', 'spark-history'],
    enabled,
    retry: false,
    queryFn: async () => toHistoryList(await getSparkHistory()),
  });
}

export function useGemHistoryQuery(enabled = true) {
  return useQuery({
    queryKey: ['forge', 'revenue', 'gem-history'],
    enabled,
    retry: false,
    queryFn: async () => toHistoryList(await getGemHistory()),
  });
}

export function useRevenueShareConfigQuery(enabled = true) {
  return useQuery({
    queryKey: ['forge', 'revenue', 'share-config'],
    enabled,
    retry: false,
    queryFn: async (): Promise<RevenueShareConfigData> =>
      toRevenueShareConfigData(await getRevenueShareConfig()),
  });
}

export function useRevenuePreviewQuery(amount: string, agentId: string, enabled = true) {
  return useQuery({
    queryKey: ['forge', 'revenue', 'preview', amount, agentId],
    enabled: enabled && Boolean(amount) && Boolean(agentId),
    retry: false,
    queryFn: async (): Promise<RevenuePreviewData> => await previewRevenueDistribution(amount, agentId),
  });
}

export function useConnectStatusQuery(enabled = true) {
  return useQuery({
    queryKey: ['forge', 'revenue', 'connect-status'],
    enabled,
    retry: false,
    queryFn: async (): Promise<ConnectStatusData> =>
      toConnectStatusData(await getConnectStatus()),
  });
}

export function useWithdrawalConfigQuery(enabled = true) {
  return useQuery({
    queryKey: ['forge', 'revenue', 'withdrawal-config'],
    enabled,
    retry: false,
    queryFn: async (): Promise<WithdrawalConfigData> =>
      toWithdrawalConfigData(await getWithdrawalConfig()),
  });
}

export function useCanWithdrawQuery(enabled = true) {
  return useQuery({
    queryKey: ['forge', 'revenue', 'can-withdraw'],
    enabled,
    retry: false,
    queryFn: async (): Promise<CanWithdrawData> =>
      toCanWithdrawData(await canWithdraw()),
  });
}

export function useWithdrawalCalculateQuery(amount: string, enabled = true) {
  return useQuery({
    queryKey: ['forge', 'revenue', 'calculate', amount],
    enabled: enabled && Boolean(amount),
    retry: false,
    queryFn: async (): Promise<WithdrawalCalculationData> =>
      toWithdrawalCalculationData(await calculateWithdrawal(amount)),
  });
}

export function useWithdrawalHistoryQuery(enabled = true) {
  return useQuery({
    queryKey: ['forge', 'revenue', 'withdrawal-history'],
    enabled,
    retry: false,
    queryFn: async () => toWithdrawalList(await getWithdrawalHistory()),
  });
}
