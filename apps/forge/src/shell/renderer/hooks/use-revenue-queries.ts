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

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

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

export type WithdrawalEntry = {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
  completedAt: string | null;
};

// ── Normalizers ──────────────────────────────────────────────

function toBalanceData(payload: unknown): BalanceData {
  const r = toRecord(payload);
  return {
    sparkBalance: Number(r.sparkBalance ?? r.spark ?? 0),
    gemBalance: Number(r.gemBalance ?? r.gem ?? 0),
  };
}

function toHistoryList(payload: unknown): HistoryEntry[] {
  const r = toRecord(payload);
  const items = Array.isArray(r.items) ? (r.items as unknown[]) : (Array.isArray(payload) ? (payload as unknown[]) : []);
  return items.map((item) => {
    const i = toRecord(item);
    return {
      id: String(i.id || ''),
      type: String(i.type || i.transactionType || ''),
      amount: Number(i.amount ?? 0),
      fromUserId: i.fromUserId ? String(i.fromUserId) : null,
      description: String(i.description || i.memo || ''),
      createdAt: String(i.createdAt || ''),
    };
  }).filter((i) => Boolean(i.id));
}

function toWithdrawalList(payload: unknown): WithdrawalEntry[] {
  const r = toRecord(payload);
  const items = Array.isArray(r.items) ? (r.items as unknown[]) : (Array.isArray(payload) ? (payload as unknown[]) : []);
  return items.map((item) => {
    const i = toRecord(item);
    return {
      id: String(i.id || ''),
      amount: Number(i.amount ?? 0),
      status: String(i.status || ''),
      createdAt: String(i.createdAt || ''),
      completedAt: i.completedAt ? String(i.completedAt) : null,
    };
  }).filter((i) => Boolean(i.id));
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
    queryFn: async () => toRecord(await getRevenueShareConfig()),
  });
}

export function useRevenuePreviewQuery(amount: string, agentId: string, enabled = true) {
  return useQuery({
    queryKey: ['forge', 'revenue', 'preview', amount, agentId],
    enabled: enabled && Boolean(amount) && Boolean(agentId),
    retry: false,
    queryFn: async () => toRecord(await previewRevenueDistribution(amount, agentId)),
  });
}

export function useConnectStatusQuery(enabled = true) {
  return useQuery({
    queryKey: ['forge', 'revenue', 'connect-status'],
    enabled,
    retry: false,
    queryFn: async () => {
      const r = toRecord(await getConnectStatus());
      return { status: String(r.status || 'not_connected') } as ConnectStatusData;
    },
  });
}

export function useWithdrawalConfigQuery(enabled = true) {
  return useQuery({
    queryKey: ['forge', 'revenue', 'withdrawal-config'],
    enabled,
    retry: false,
    queryFn: async () => toRecord(await getWithdrawalConfig()),
  });
}

export function useCanWithdrawQuery(enabled = true) {
  return useQuery({
    queryKey: ['forge', 'revenue', 'can-withdraw'],
    enabled,
    retry: false,
    queryFn: async () => toRecord(await canWithdraw()),
  });
}

export function useWithdrawalCalculateQuery(amount: string, enabled = true) {
  return useQuery({
    queryKey: ['forge', 'revenue', 'calculate', amount],
    enabled: enabled && Boolean(amount),
    retry: false,
    queryFn: async () => toRecord(await calculateWithdrawal(amount)),
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
