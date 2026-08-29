import { Clock3, Eye, TriangleAlert } from 'lucide-react';

import type { ZhiyuResourcePackPresentationState } from './presentation-controller.js';

export function ZhiyuResourcePackStatusNotice({
  state,
}: {
  readonly state: ZhiyuResourcePackPresentationState;
}) {
  if (state.pendingTruth === 'apply-outcome-unknown' || state.pendingTruth === 'clear-outcome-unknown') {
    const applying = state.pendingTruth === 'apply-outcome-unknown';
    return (
      <div className="zhiyu-resource-pack-status is-warning" data-zhiyu-resource-pack-status="outcome-unknown" role="status">
        <TriangleAlert aria-hidden="true" size={14} />
        <span>
          <strong>{applying ? '应用结果待确认' : '清除结果待确认'}</strong>
          {' '}当前保持上一次安全体验；暂时无法确认资源包选择是否已经{applying ? '写入' : '清除'}，请刷新后确认。
        </span>
      </div>
    );
  }
  if (state.phase === 'preview') {
    return (
      <div className="zhiyu-resource-pack-status" data-zhiyu-resource-pack-status="preview" role="status">
        <Eye aria-hidden="true" size={14} />
        <span><strong>正在预览 · 尚未应用</strong> 当前变化只用于检查这个资源包。</span>
      </div>
    );
  }
  if (state.phase === 'apply-in-flight') {
    return (
      <div className="zhiyu-resource-pack-status" data-zhiyu-resource-pack-status="apply-in-flight" role="status">
        <Clock3 aria-hidden="true" size={14} />
        <span><strong>正在应用 · 尚未生效</strong> 当前仍显示上一次安全体验；资源包尚未写入。</span>
      </div>
    );
  }
  if (state.phase === 'render-pending') {
    return (
      <div className="zhiyu-resource-pack-status" data-zhiyu-resource-pack-status="render-pending" role="status">
        <Clock3 aria-hidden="true" size={14} />
        <span><strong>已保存 · 正在载入体验</strong> 当前仍显示上一次安全体验；新资源包尚未渲染。</span>
      </div>
    );
  }
  if (state.phase === 'fallback') {
    return (
      <div className="zhiyu-resource-pack-status is-warning" data-zhiyu-resource-pack-status="fallback" role="status">
        <TriangleAlert aria-hidden="true" size={14} />
        <span><strong>已选择的资源包无法显示</strong> 当前使用织羽默认体验，可在伙伴中心重试或清除。</span>
      </div>
    );
  }
  return null;
}
