import type { ReactNode } from 'react';
import { StatusBadge } from '@nimiplatform/nimi-kit/ui';
import type { ImportRecord, VenueRecord } from '@renderer/data/types.js';

import type { SurfaceId } from './app-helpers.js';
import type { VideoFoodMapIntakeTarget } from './intake.js';

export const SURFACES: Array<{ id: SurfaceId; label: string; badge: string; description: string }> = [
  { id: 'discover', label: '发现', badge: '罗', description: '视频与店铺详情' },
  { id: 'nearby-map', label: '附近地图', badge: '位', description: '按当前位置找店' },
  { id: 'video-map', label: '单视频地图', badge: '图', description: '只看当前视频点位' },
  { id: 'review', label: '待确认', badge: '列', description: '逐条审核未上图店铺' },
  { id: 'menu', label: '偏好设置', badge: '设', description: '偏好与模型设置' },
];

export type ReviewItem = {
  venue: VenueRecord;
  record: ImportRecord;
};

export function InfoPill(props: {
  children: ReactNode;
  tone?: 'neutral' | 'warm' | 'danger' | 'info';
}) {
  const toneClass = props.tone === 'danger'
    ? 'vfm-pill-danger'
    : props.tone === 'warm'
      ? 'vfm-pill-warm'
      : props.tone === 'info'
        ? 'vfm-pill-info'
        : 'vfm-pill-neutral';

  return (
    <span className={`inline-flex max-w-full items-center overflow-hidden text-ellipsis rounded-full border px-3 py-1.5 text-sm font-medium leading-5 whitespace-nowrap ${toneClass}`}>
      {props.children}
    </span>
  );
}

export function resolveVenueStatus(venue: VenueRecord) {
  if (venue.userConfirmed) {
    return { label: '已确认', tone: 'success' as const };
  }
  if (venue.reviewState === 'map_ready') {
    return { label: '已上图', tone: 'success' as const };
  }
  if (venue.reviewState === 'review' || venue.geocodeStatus === 'failed') {
    return { label: venue.geocodeStatus === 'failed' ? '定位失败' : '待确认', tone: 'warning' as const };
  }
  return { label: '仅列表展示', tone: 'info' as const };
}

export function formatCommentTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatSelectedModelLabel(value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '按当前默认值';
  }
  if (normalized.startsWith('local/')) {
    return normalized.slice('local/'.length);
  }
  if (normalized.startsWith('cloud/')) {
    return normalized.slice('cloud/'.length);
  }
  return normalized;
}

export function formatConfidenceLabel(value: string): string {
  switch (String(value || '').trim()) {
    case 'high':
      return '高';
    case 'medium':
      return '中';
    case 'low':
      return '低';
    default:
      return '待确认';
  }
}

export function buildIntakeStatusBadge(target: VideoFoodMapIntakeTarget) {
  if (target.kind === 'video') {
    return <StatusBadge tone="success">视频链接</StatusBadge>;
  }
  if (target.kind === 'creator') {
    return <StatusBadge tone="warning">博主主页</StatusBadge>;
  }
  return <StatusBadge tone="neutral">自动识别</StatusBadge>;
}
