// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { MilestoneTimelineCard, ObservationDistributionCard, RecentLinesCard, SleepTrendCard } from './timeline-cards.js';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (value: string) => value,
}));

function renderInRouter(node: ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe('timeline dashboard cards', () => {
  it('renders sleep trend content when data exists', () => {
    renderInRouter(
      <SleepTrendCard
        summary={{
          points: [
            { date: '2026-04-14', durationMinutes: 600, bedtime: '21:00', wakeTime: '07:00' },
            { date: '2026-04-15', durationMinutes: 540, bedtime: '21:30', wakeTime: '06:30' },
          ],
          avgDurationMinutes: 570,
          latestBedtime: '21:30',
          latestWakeTime: '06:30',
          totalRecords: 2,
        }}
      />,
    );

    expect(screen.getByText('睡眠趋势')).toBeTruthy();
    expect(screen.getByText('近两周平均时长')).toBeTruthy();
    expect(screen.getByText('9h30m')).toBeTruthy();
  });

  it('renders milestone timeline with achieved and upcoming', () => {
    renderInRouter(
      <MilestoneTimelineCard
        summary={{
          recentlyAchieved: [
            { milestoneId: 'PO-MS-GMOT-001', title: '抬头', domain: 'gross-motor', achievedAt: '2026-04-10T08:00:00.000Z', typicalAgeLabel: '2个月' },
          ],
          upcoming: [
            { milestoneId: 'PO-MS-GMOT-003', title: '独坐', domain: 'gross-motor', typicalAgeLabel: '6个月' },
          ],
        }}
      />,
    );

    expect(screen.getByText('里程碑')).toBeTruthy();
    expect(screen.getByText('最近达成')).toBeTruthy();
    expect(screen.getByText('抬头')).toBeTruthy();
    expect(screen.getByText('接下来关注')).toBeTruthy();
    expect(screen.getByText('独坐')).toBeTruthy();
  });

  it('renders observation distribution with dimension bars', () => {
    renderInRouter(
      <ObservationDistributionCard
        summary={{
          items: [
            { dimensionId: 'PO-OBS-MOVE-001', displayName: '大运动发展', count: 3, ratio: 0.6 },
            { dimensionId: 'PO-OBS-LANG-001', displayName: '语言表达', count: 2, ratio: 0.4 },
          ],
          totalEntries: 5,
        }}
      />,
    );

    expect(screen.getByText('观察维度分布')).toBeTruthy();
    expect(screen.getByText('大运动发展')).toBeTruthy();
    expect(screen.getByText('语言表达')).toBeTruthy();
    expect(screen.getByText(/共 5 条/)).toBeTruthy();
  });

  it('renders empty states without crashing', () => {
    renderInRouter(
      <>
        <SleepTrendCard
          summary={{
            points: [],
            avgDurationMinutes: null,
            latestBedtime: null,
            latestWakeTime: null,
            totalRecords: 0,
          }}
        />
        <MilestoneTimelineCard
          summary={{ recentlyAchieved: [], upcoming: [] }}
        />
        <ObservationDistributionCard
          summary={{ items: [], totalEntries: 0 }}
        />
      </>,
    );

    expect(screen.getByText('还没有睡眠记录')).toBeTruthy();
    expect(screen.getByText('当前阶段暂无匹配的里程碑')).toBeTruthy();
    expect(screen.getByText('还没有带维度标记的观察记录')).toBeTruthy();
  });
  it('renders keepsake badges and reason tags in recent lines', () => {
    renderInRouter(
      <RecentLinesCard
        lines={[
          {
            id: 'line-1',
            title: '读完第一本桥梁书',
            detail: '珍藏原因：取得成果',
            recordedAt: '2026-04-15T08:00:00.000Z',
            to: '/journal?filter=keepsake',
            badge: '珍藏',
            badgeTone: 'keepsake',
            tag: '取得成果',
          },
        ]}
      />,
    );

    expect(screen.getByText('读完第一本桥梁书')).toBeTruthy();
    expect(screen.getByText('珍藏')).toBeTruthy();
    expect(screen.getByText('取得成果')).toBeTruthy();
  });
});
