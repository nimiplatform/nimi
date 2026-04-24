import { describe, expect, it } from 'vitest';
import {
  buildCurrentReadMessage,
  buildEmptyConversationMessage,
  buildManualAnalysisGuardMessage,
} from './sector-workspace-state.js';

describe('sector workspace state helpers', () => {
  it('shows a manual load message before prices are requested', () => {
    expect(buildCurrentReadMessage({
      sectorLabel: 'Politics',
      latestAnalystText: '',
      marketDataRequested: false,
      analysisReady: false,
      loadingMarketData: false,
    })).toContain('可以先讨论结构');
  });

  it('shows a ready message after prices are prepared but before chat starts', () => {
    expect(buildEmptyConversationMessage({
      sectorLabel: 'Politics',
      marketDataRequested: true,
      analysisReady: true,
      loadingMarketData: false,
    })).toContain('等你主动发起分析');
  });

  it('builds a strict guard message for manual analysis initiation', () => {
    expect(buildManualAnalysisGuardMessage({
      sectorLabel: 'Politics',
      windowLabel: '48h',
    })).toBe('请先点击 Load Prices，加载 Politics 在 48h 窗口下的价格和历史数据，再发起盘口分析。');
  });
});
