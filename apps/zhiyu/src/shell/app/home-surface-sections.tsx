import { Button, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import {
  Bot,
  Fingerprint,
  MessagesSquare,
  Route,
  Server,
  Sparkles,
  UserRoundCheck,
} from 'lucide-react';
import type { ZhiyuEvidence } from './evidence';
import type {
  ZhiyuDiagnosticItem,
  ZhiyuDiagnosticSeverity,
  ZhiyuDiagnosticState,
} from './diagnostic-state';
import type {
  ZhiyuHomeGatedSurface,
  ZhiyuHomeStatusCard,
} from './home-product-state';
import type {
  ZhiyuIdentityFloorItem,
  ZhiyuIdentityFloorItemState,
  ZhiyuIdentityFloorState,
} from './identity-floor-state';
import {
  formatZhiyuCompanionEmotionLabel,
} from '../agent/companion-emotion';

export function formatProjectionValue(value: string | null | undefined): string {
  if (!value || value === 'not_projected') {
    return '尚未准备';
  }
  if (value === 'not_admitted') {
    return '尚未开放';
  }
  if (value === 'runtime' || value === 'sdk') {
    return '本地服务';
  }
  if (value === 'renderer') {
    return '本地界面';
  }
  if (value === 'electron') {
    return '桌面壳';
  }
  if (value === 'blocked') {
    return '等待授权';
  }
  if (value === 'projected') {
    return '已准备';
  }
  if (value === 'ready') {
    return '已就绪';
  }
  if (value === 'live2d') {
    return 'Live2D';
  }
  if (/zhiyu-avatar-blocked/i.test(value)) {
    return '等待授权';
  }
  if (/zhiyu-avatar-projected/i.test(value)) {
    return '已同步';
  }
  return value;
}

export function formatReasonLabel(ready: boolean, reasonCode: string): string {
  if (ready) {
    return '已就绪';
  }
  if (/missing|required|unavailable|blocked|not[_-]projected|not[_-]admitted/i.test(reasonCode)) {
    if (/ai-config|capability[-_]intent/i.test(reasonCode)) {
      return '需要模型设置';
    }
    if (/local-agent|agent|required|source/i.test(reasonCode)) {
      return '需要伙伴';
    }
    return '需要处理';
  }
  if (/failed|error|denied|revoked/i.test(reasonCode)) {
    return '需要处理';
  }
  return '同步中';
}

export function CompanionEmotionStatus({ companion }: { readonly companion: ZhiyuEvidence['companion'] }) {
  const label = formatZhiyuCompanionEmotionLabel(companion);
  const tone = companion.emotionViolation
    ? 'warning'
    : companion.currentEmotionCue
      ? 'success'
      : 'neutral';
  return (
    <span
      className="zhiyu-chat-canvas__labeled-chip"
      data-zhiyu-region="companion"
      data-zhiyu-companion-current-emotion-id={companion.currentEmotionId ?? 'not_projected'}
      data-zhiyu-companion-current-emotion-cue={companion.currentEmotionCue ?? 'not_projected'}
      data-zhiyu-companion-current-emotion-intensity={companion.currentEmotionIntensity ?? 'not_projected'}
      data-zhiyu-companion-emotion-violation={companion.emotionViolation ? 'true' : 'false'}
      data-zhiyu-companion-emotion-violation-reason={companion.emotionViolation?.reasonCode ?? 'none'}
      data-zhiyu-companion-current-emotion-label={label}
    >
      <span className="zhiyu-chat-canvas__chip-label">相处</span>
      <StatusBadge tone={tone} shape="dot">
        {label}
      </StatusBadge>
      {companion.statusText && !companion.currentEmotionId && !companion.emotionViolation ? (
        <span
          className="max-w-[180px] truncate text-[11px] text-[var(--nimi-text-secondary)]"
          data-nimi-semantic-id="zhiyu-companion-status"
          title={companion.statusText}
        >
          {companion.statusText}
        </span>
      ) : null}
    </span>
  );
}

export function AvatarPresenceSection({
  surface,
  avatar,
  onLaunch,
  onManage,
}: {
  readonly surface: ZhiyuHomeGatedSurface;
  readonly avatar: ZhiyuEvidence['avatar'];
  readonly onLaunch?: () => void;
  readonly onManage?: () => void;
}) {
  const controlState = avatar.launchAvailable || avatar.manageAvailable ? 'authorized' : 'blocked';
  const resourceState = avatar.ready ? 'avatar-facade-projected' : 'blocked';
  const avatarStatusLabel = avatar.ready ? '伙伴形象已连接' : '等待形象权限';
  const avatarMessage = avatar.ready
    ? '可以启动或管理当前伙伴形象。'
    : '获得权限后即可启动或管理伙伴形象。';
  return (
    <Surface
      as="section"
      className="zhiyu-home__gated zhiyu-home__avatar-presence"
      data-zhiyu-region="avatar"
      data-zhiyu-gated-surface="avatar"
      data-zhiyu-avatar-presence={avatar.state}
      data-zhiyu-avatar-ready={String(avatar.ready)}
      data-zhiyu-avatar-reason={avatar.reasonCode}
      data-zhiyu-avatar-launch-available={String(avatar.launchAvailable)}
      data-zhiyu-avatar-manage-available={String(avatar.manageAvailable)}
      data-zhiyu-avatar-configuration-ref={avatar.configurationRef ?? 'not_projected'}
      data-zhiyu-avatar-control-state={controlState}
      material="glass-thin"
      elevation="base"
      padding="md"
    >
      <div className="zhiyu-home__section-heading">
        <Bot size={18} aria-hidden="true" />
        <div>
          <h2>{surface.title}</h2>
          <p>{surface.description}</p>
        </div>
      </div>
      <div className="zhiyu-home__avatar-product">
        <div
          className="zhiyu-home__avatar-status-token"
          data-zhiyu-avatar-resource-state={resourceState}
          data-zhiyu-avatar-resource-ref="not-owned-by-zhiyu"
          aria-hidden="true"
        >
          <Bot size={22} />
        </div>
        <div className="zhiyu-home__avatar-copy">
          <div className="zhiyu-home__avatar-summary">
            <StatusBadge tone={avatar.ready ? 'success' : 'warning'} shape="dot">
              {avatarStatusLabel}
            </StatusBadge>
          </div>
          <p>{avatarMessage}</p>
          <div className="zhiyu-home__avatar-actions" data-zhiyu-avatar-actions={controlState}>
            {avatar.launchAvailable ? (
              <Button
                type="button"
                tone="secondary"
                size="sm"
                disabled={!onLaunch}
                onClick={onLaunch}
                data-zhiyu-avatar-launch-action="available"
              >
                启动形象
              </Button>
            ) : null}
            {avatar.manageAvailable ? (
              <Button
                type="button"
                tone="secondary"
                size="sm"
                disabled={!onManage}
                onClick={onManage}
                data-zhiyu-avatar-manage-action="available"
              >
                管理形象
              </Button>
            ) : null}
            {!avatar.launchAvailable && !avatar.manageAvailable ? (
              <span data-zhiyu-avatar-actions-hidden="true" aria-hidden="true" />
            ) : null}
          </div>
        </div>
      </div>
      {avatar.ready ? (
        <div className="zhiyu-home__avatar-grid" aria-label="形象状态">
          <AvatarPresenceField label="配置" value={avatar.configurationRef} />
        </div>
      ) : null}
    </Surface>
  );
}

function AvatarPresenceField({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | null;
}) {
  return (
    <div
      className="zhiyu-home__avatar-item"
      data-zhiyu-avatar-field={label}
      data-zhiyu-avatar-field-state={value ? 'projected' : 'not_projected'}
    >
      <span>{label}</span>
      <strong>{formatProjectionValue(value)}</strong>
    </div>
  );
}

export function IdentityFloorSection({
  surface,
  identityFloor,
}: {
  readonly surface: ZhiyuHomeGatedSurface;
  readonly identityFloor: ZhiyuIdentityFloorState;
}) {
  return (
    <Surface
      as="section"
      className="zhiyu-home__gated zhiyu-home__identity-floor"
      data-zhiyu-region="identity"
      data-zhiyu-gated-surface="identity"
      data-zhiyu-identity-floor="read-only-boundary-projection"
      data-zhiyu-identity-state={identityFloor.state}
      data-zhiyu-identity-reason={identityFloor.summaryReasonCode}
      data-zhiyu-identity-ready-count={String(identityFloor.readyCount)}
      data-zhiyu-identity-blocked-count={String(identityFloor.blockedCount)}
      data-zhiyu-identity-not-admitted-count={String(identityFloor.notAdmittedCount)}
      material="glass-thin"
      elevation="base"
      padding="md"
    >
      <div className="zhiyu-home__section-heading">
        <Fingerprint size={18} aria-hidden="true" />
        <div>
          <h2>{surface.title}</h2>
          <p>{surface.description}</p>
        </div>
      </div>
      <div className="zhiyu-home__identity-summary">
        <StatusBadge tone={identityFloor.state === 'ready' ? 'success' : 'warning'} shape="dot">
          {identityFloor.state === 'ready' ? '已就绪' : '等待同步'}
        </StatusBadge>
        <span>{identityFloor.readyCount} 项就绪</span>
        <span>{identityFloor.blockedCount} 项等待</span>
        <span>{identityFloor.notAdmittedCount} 项尚未开放</span>
      </div>
      <p
        className="zhiyu-home__identity-note"
        data-zhiyu-identity-overwrite-policy="runtime-owned"
      >
        身份不会被单条消息或一条记忆冲突覆盖。
      </p>
      <div className="zhiyu-home__identity-grid" aria-label="身份保护状态">
        {identityFloor.items.map((item) => (
          <IdentityFloorItemRow key={item.key} item={item} />
        ))}
      </div>
      <div className="zhiyu-home__identity-unsupported" aria-label="尚未开放的身份保护信息">
        {identityFloor.unsupportedProjectionFields.map((field) => (
          <span
            key={field}
            data-zhiyu-identity-unsupported-field={field}
            data-zhiyu-identity-unsupported-state="not_admitted"
          >
            {identityUnsupportedLabel(field)}：尚未开放
          </span>
        ))}
      </div>
      <p className="zhiyu-home__action-hint">{identityFloor.actionHint}</p>
    </Surface>
  );
}

function IdentityFloorItemRow({ item }: { readonly item: ZhiyuIdentityFloorItem }) {
  return (
    <div
      className="zhiyu-home__identity-item"
      data-zhiyu-identity-item={item.key}
      data-zhiyu-identity-item-state={item.state}
      data-zhiyu-identity-item-reason={item.reasonCode}
      data-zhiyu-identity-item-source={item.source}
      data-zhiyu-identity-item-rule={item.sourceRule}
    >
      <div>
        <strong>{item.title}</strong>
        <small>{item.owner}</small>
      </div>
      <StatusBadge tone={toneForIdentityItemState(item.state)} shape="dot">
        {identityItemStateLabel(item.state)}
      </StatusBadge>
    </div>
  );
}

function identityItemStateLabel(state: ZhiyuIdentityFloorItemState): string {
  if (state === 'ready') return '已就绪';
  if (state === 'not-admitted') return '尚未开放';
  return '等待同步';
}

function identityUnsupportedLabel(field: string): string {
  if (field === 'identityConflictEvent') return '身份冲突事件';
  if (field === 'firewallThreatIndicators') return '防护威胁指标';
  if (field === 'firewallNormalizedOutputDiff') return '防护输出差异';
  return field.replaceAll('_', ' ');
}

export function DiagnosticSurface({ diagnostics }: { readonly diagnostics: ZhiyuDiagnosticState }) {
  const visibleItems = diagnostics.items
    .filter((item) => item.severity !== 'ready')
    .slice(0, 5);
  const primary = diagnostics.primaryBlocker;
  return (
    <Surface
      as="section"
      className="zhiyu-home__diagnostics"
      data-zhiyu-region="diagnostics"
      data-zhiyu-diagnostic-surface="fail-closed"
      data-zhiyu-diagnostic-mode={diagnostics.mode}
      data-zhiyu-diagnostic-primary-blocker={primary?.key ?? 'none'}
      material="glass-thin"
      elevation="base"
      padding="md"
    >
      <div className="zhiyu-home__section-heading">
        <Route size={18} aria-hidden="true" />
        <div>
          <h2>诊断</h2>
          <p>汇总本地服务、账户、来源、伙伴、会话和回复状态，便于定位问题。</p>
        </div>
      </div>
      <div className="zhiyu-home__diagnostic-summary">
        <StatusBadge tone={diagnostics.mode === 'ready' ? 'success' : 'warning'} shape="dot">
          {diagnosticModeLabel(diagnostics.mode)}
        </StatusBadge>
        <span>{diagnostics.readyCount} 项正常</span>
        <span>{diagnostics.blockedCount} 项受阻</span>
        <span>{diagnostics.errorCount} 项错误</span>
      </div>
      {primary ? (
        <div className="zhiyu-home__diagnostic-primary">
          <span>主要问题</span>
          <strong>{primary.reasonCode}</strong>
          <small>{primary.actionHint}</small>
        </div>
      ) : (
        <div className="zhiyu-home__diagnostic-primary">
          <span>主要问题</span>
          <strong>无</strong>
          <small>all_required_runtime_surfaces_ready</small>
        </div>
      )}
      <div className="zhiyu-home__diagnostic-list" aria-label="诊断问题列表">
        {visibleItems.map((item) => (
          <DiagnosticRow key={item.key} item={item} />
        ))}
      </div>
    </Surface>
  );
}

function DiagnosticRow({ item }: { readonly item: ZhiyuDiagnosticItem }) {
  return (
    <div
      className="zhiyu-home__diagnostic-row"
      data-zhiyu-diagnostic-item={item.key}
      data-zhiyu-diagnostic-state={item.severity}
      data-zhiyu-diagnostic-source={item.source}
      data-zhiyu-diagnostic-reason={item.reasonCode}
      data-zhiyu-diagnostic-action={item.actionHint}
      data-zhiyu-diagnostic-trace-id={item.traceId}
    >
      <div>
        <strong>{item.title}</strong>
        <small>{item.reasonCode}</small>
      </div>
      <StatusBadge tone={toneForDiagnosticSeverity(item.severity)} shape="dot">
        {item.actionHint}
      </StatusBadge>
    </div>
  );
}

export function StatusRow({ card }: { readonly card: ZhiyuHomeStatusCard }) {
  const Icon = iconByStatusKey(card.key);
  return (
    <div
      className="zhiyu-home__status-row"
      data-zhiyu-status-card={card.key}
      data-zhiyu-status-ready={String(card.ready)}
      data-zhiyu-status-reason={card.reasonCode}
    >
      <span className="zhiyu-home__status-icon" aria-hidden="true">
        <Icon size={16} />
      </span>
      <div className="zhiyu-home__status-copy">
        <span>{card.title}</span>
        <small>{card.label}</small>
      </div>
      <StatusBadge tone={card.tone} shape="dot">
        {formatReasonLabel(card.ready, card.reasonCode)}
      </StatusBadge>
    </div>
  );
}

function iconByStatusKey(key: string) {
  switch (key) {
    case 'runtime':
      return Server;
    case 'auth':
      return UserRoundCheck;
    case 'turn':
      return Route;
    case 'conversation':
      return MessagesSquare;
    case 'source':
    case 'inventory':
    case 'localAgent':
    default:
      return Sparkles;
  }
}

function toneForIdentityItemState(state: ZhiyuIdentityFloorItemState) {
  switch (state) {
    case 'ready':
      return 'success';
    case 'not-admitted':
      return 'info';
    case 'blocked':
    default:
      return 'warning';
  }
}

function toneForDiagnosticSeverity(severity: ZhiyuDiagnosticSeverity) {
  switch (severity) {
    case 'ready':
      return 'success';
    case 'pending':
      return 'neutral';
    case 'error':
      return 'danger';
    case 'blocked':
    default:
      return 'warning';
  }
}

function diagnosticModeLabel(mode: ZhiyuDiagnosticState['mode']): string {
  if (mode === 'ready') return '运行正常';
  if (mode === 'probing') return '检查中';
  return '需要处理';
}
