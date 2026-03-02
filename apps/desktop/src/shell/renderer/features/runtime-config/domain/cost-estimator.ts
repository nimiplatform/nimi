import { useMemo } from 'react';

export type CostBreakdownEntry = {
  provider: string;
  dailyUsd: number;
  monthlyUsd: number;
};

export type CostEstimate = {
  dailyUsd: number;
  monthlyUsd: number;
  breakdown: CostBreakdownEntry[];
};

const MOCK_BREAKDOWN: CostBreakdownEntry[] = [
  { provider: 'OpenRouter', dailyUsd: 0.42, monthlyUsd: 12.60 },
  { provider: 'OpenAI', dailyUsd: 0.18, monthlyUsd: 5.40 },
  { provider: 'Local Runtime', dailyUsd: 0.00, monthlyUsd: 0.00 },
];

export function useMockCostEstimate(): CostEstimate {
  return useMemo(() => {
    const dailyUsd = MOCK_BREAKDOWN.reduce((sum, entry) => sum + entry.dailyUsd, 0);
    const monthlyUsd = MOCK_BREAKDOWN.reduce((sum, entry) => sum + entry.monthlyUsd, 0);
    return { dailyUsd, monthlyUsd, breakdown: MOCK_BREAKDOWN };
  }, []);
}
