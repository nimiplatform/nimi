import { Button, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import {
  Bot,
  Fingerprint,
  MessagesSquare,
  Route,
  Server,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
} from 'lucide-react';
import type { ZhiyuEvidence } from './evidence';
import type {
  ZhiyuCapabilityRoomItemState,
  ZhiyuCapabilityRoomOwnerCard,
  ZhiyuCapabilityRoomState,
} from './capability-room-state';
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
    return '已投影';
  }
  return value;
}

export function formatReasonLabel(ready: boolean, reasonCode: string): string {
  if (ready) {
    return '已就绪';
  }
  if (/missing|required|unavailable|blocked|not[_-]projected|not[_-]admitted/i.test(reasonCode)) {
    if (/route|model|ai-config/i.test(reasonCode)) {
      return '需要模型';
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
  const resourceState = avatar.ready ? 'runtime-profile-projected' : 'blocked';
  const avatarStatusLabel = avatar.ready ? '形象投影已连接' : '等待形象授权';
  const avatarMessage = avatar.ready
    ? `${avatar.message} 本地形象资源仍需在外观配置中导入和管理。`
    : '形象启动和管理会在获得授权后出现。';
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
      data-zhiyu-avatar-projection-ref={avatar.projectionRef ?? 'not_projected'}
      data-zhiyu-avatar-configuration-ref={avatar.configurationRef ?? 'not_projected'}
      data-zhiyu-avatar-backend-kind={avatar.backendKind ?? 'not_projected'}
      data-zhiyu-avatar-visual-readiness={avatar.visualReadiness}
      data-zhiyu-avatar-voice-readiness={avatar.voiceReadiness}
      data-zhiyu-avatar-control-state={controlState}
      data-zhiyu-avatar-unsupported-count={String(avatar.unsupportedFields.length)}
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
          <AvatarPresenceField label="后端" value={avatar.backendKind} />
          <AvatarPresenceField label="视觉" value={avatar.visualReadiness} />
          <AvatarPresenceField label="声音" value={avatar.voiceReadiness} />
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
          {identityFloor.state === 'ready' ? '已就绪' : '等待投影'}
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
      <div className="zhiyu-home__identity-grid" aria-label="身份地板投影">
        {identityFloor.items.map((item) => (
          <IdentityFloorItemRow key={item.key} item={item} />
        ))}
      </div>
      <div className="zhiyu-home__identity-unsupported" aria-label="身份地板未开放投影">
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
  return '等待投影';
}

function identityUnsupportedLabel(field: string): string {
  if (field === 'identityConflictEvent') return '身份冲突事件';
  if (field === 'firewallThreatIndicators') return '防护威胁指标';
  if (field === 'firewallNormalizedOutputDiff') return '防护输出差异';
  return field.replaceAll('_', ' ');
}

export function CapabilityRoomSection({ capabilityRoom }: { readonly capabilityRoom: ZhiyuCapabilityRoomState }) {
  return (
    <Surface
      as="section"
      className="zhiyu-home__gated zhiyu-home__capability-room"
      data-zhiyu-region="capability"
      data-zhiyu-gated-surface="capability"
      data-zhiyu-capability-room="canonical-catalog-projection"
      data-zhiyu-capability-catalog-count={String(capabilityRoom.catalogCount)}
      data-zhiyu-capability-deferred-count={String(capabilityRoom.deferredCount)}
      data-zhiyu-capability-route-state={capabilityRoom.routeReasonCode}
      data-zhiyu-capability-route-ready={String(capabilityRoom.routeReady)}
      material="glass-thin"
      elevation="base"
      padding="md"
    >
      <div className="zhiyu-home__section-heading">
        <ShieldCheck size={18} aria-hidden="true" />
        <div>
          <h2>{capabilityRoom.title}</h2>
          <p>只读展示已准入能力、模型通路与尚未开放的记忆使用边界。</p>
        </div>
      </div>
      <div className="zhiyu-home__capability-summary">
        <StatusBadge tone={capabilityRoom.routeReady ? 'success' : 'warning'} shape="dot">
          {capabilityRoom.routeReady ? '模型已配置' : '等待模型配置'}
        </StatusBadge>
        <span>{capabilityRoom.catalogCount} 项能力</span>
        <span>{capabilityRoom.deferredCount} 项待开放</span>
        <span>{capabilityRoom.executionBindingLabel}</span>
      </div>
      <div className="zhiyu-home__owner-grid" aria-label="能力边界 owner">
        {capabilityRoom.owners.map((owner) => (
          <OwnerCard key={owner.key} owner={owner} />
        ))}
      </div>
      <div className="zhiyu-home__capability-list" aria-label="能力目录">
        {capabilityRoom.items.map((item) => (
          <div
            key={item.capabilityId}
            className="zhiyu-home__capability-item"
            data-zhiyu-capability-item={item.capabilityId}
            data-zhiyu-capability-item-state={item.state}
            data-zhiyu-capability-item-active={String(item.active)}
            data-zhiyu-capability-current-state={item.matrix.currentState}
            data-zhiyu-capability-data-movement={item.matrix.dataMovement}
            data-zhiyu-capability-retention={item.matrix.retention}
            data-zhiyu-capability-revocation-path={item.matrix.revocationPath}
            data-zhiyu-capability-audit-source={item.matrix.auditSource}
            data-zhiyu-capability-audit-ref={item.matrix.auditRef}
            data-zhiyu-capability-unsupported-reason={item.matrix.unsupportedReason}
            data-zhiyu-capability-setup-requirement={item.matrix.setupRequirement}
          >
            <div className="zhiyu-home__capability-item-header">
              <div className="zhiyu-home__capability-item-title">
                <strong>{capabilityDisplayLabel(item.capabilityId)}</strong>
                <small>{capabilitySectionLabel(item.section)} / {formatCapabilityState(item.state)}</small>
              </div>
              <span className="zhiyu-home__capability-item-status" data-zhiyu-capability-status-badge={item.state}>
                <StatusBadge tone={toneForCapabilityState(item.state)} shape="dot">
                  {formatCapabilityState(item.state)}
                </StatusBadge>
              </span>
            </div>
            <div
              className="zhiyu-home__capability-governance"
              data-zhiyu-capability-governance-owner={item.governance.owner}
              data-zhiyu-capability-governance-data-movement={item.governance.dataMovement}
              data-zhiyu-capability-governance-retention={item.governance.retention}
              data-zhiyu-capability-governance-revocation={item.governance.revocation}
              data-zhiyu-capability-governance-audit-source={item.governance.auditSource}
              data-zhiyu-capability-governance-source={item.governance.source}
            >
              <span data-zhiyu-capability-governance-chip="current-state">{formatCapabilityState(item.matrix.currentState)}</span>
              <span data-zhiyu-capability-governance-chip="owner">{ownerDisplayLabel(item.governance.owner)}</span>
              <span data-zhiyu-capability-governance-chip="data-movement">{capabilityPolicyLabel(item.governance.dataMovement, '数据使用待投影')}</span>
              <span data-zhiyu-capability-governance-chip="retention">{capabilityPolicyLabel(item.governance.retention, '留存策略待投影')}</span>
              <span data-zhiyu-capability-governance-chip="revocation">{capabilityPolicyLabel(item.matrix.revocationPath, '撤回路径待投影')}</span>
              <span data-zhiyu-capability-governance-chip="audit-source">{capabilityPolicyLabel(item.matrix.auditSource, '审计来源待投影')}</span>
              <span data-zhiyu-capability-governance-chip="audit-ref">{capabilityPolicyLabel(item.matrix.auditRef, '审计引用待投影')}</span>
              <span data-zhiyu-capability-governance-chip="unsupported-reason">{capabilityPolicyLabel(item.matrix.unsupportedReason, '可用性已确认')}</span>
              <span data-zhiyu-capability-governance-chip="setup-requirement">{capabilityPolicyLabel(item.matrix.setupRequirement, '无需设置')}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="zhiyu-home__action-hint">{capabilityRoom.routeActionHint}</p>
    </Surface>
  );
}

function OwnerCard({ owner }: { readonly owner: ZhiyuCapabilityRoomOwnerCard }) {
  return (
    <div
      className="zhiyu-home__owner-card"
      data-zhiyu-capability-owner={owner.key}
      data-zhiyu-capability-owner-state={owner.state}
    >
      <span>{owner.title}</span>
      <strong>{ownerDisplayLabel(owner.owner)}</strong>
      <StatusBadge tone={toneForOwnerState(owner.state)} shape="dot">
        {ownerStateLabel(owner.state)}
      </StatusBadge>
    </div>
  );
}

function capabilityDisplayLabel(capabilityId: string): string {
  if (capabilityId === 'text.generate') return '文本生成';
  if (capabilityId === 'chat.stream') return '连续回复';
  if (capabilityId === 'text.embed') return '文本嵌入';
  if (capabilityId === 'image.generate') return '图片生成';
  return capabilityId;
}

function capabilitySectionLabel(section: string): string {
  if (section === 'chat') return '对话';
  if (section === 'embed') return '嵌入';
  if (section === 'image') return '图片';
  if (section === 'voice') return '声音';
  if (section === 'video') return '视频';
  return section;
}

function capabilityPolicyLabel(value: string, fallback: string): string {
  if (!value || value === 'not_projected' || value === 'not_evaluated') {
    return fallback;
  }
  if (value === 'not_unsupported') {
    return '可用性已确认';
  }
  if (value === 'none') {
    return '无需设置';
  }
  return value.replaceAll('_', ' ');
}

function ownerDisplayLabel(owner: string): string {
  if (owner === 'not_projected') return '等待投影';
  if (owner === '能力目录') return owner;
  if (owner === '模型通路') return owner;
  if (owner === '模型配置') return owner;
  if (owner === '记忆投影') return owner;
  if (/Platform capability catalog/i.test(owner)) return '能力目录';
  if (/Runtime\/SDK route projection|Runtime route projection/i.test(owner)) return '模型通路';
  if (/AIConfig/i.test(owner)) return '模型配置';
  if (/Cognition memory projection/i.test(owner)) return '记忆投影';
  return owner;
}

function ownerStateLabel(state: ZhiyuCapabilityRoomOwnerCard['state']): string {
  if (state === 'ready') return '已就绪';
  if (state === 'not-admitted') return '尚未开放';
  return '等待就绪';
}

function formatCapabilityState(state: ZhiyuCapabilityRoomItemState): string {
  switch (state) {
    case 'ready':
      return '已就绪';
    case 'catalog-only':
      return '目录内';
    case 'needs-setup':
      return '需要设置';
    case 'denied':
      return '未授权';
    case 'revoked':
      return '已撤回';
    case 'unsupported':
      return '不支持';
    case 'unavailable':
    default:
      return '暂不可用';
  }
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
          <p>把当前 Runtime、账户、来源、Agent、路由和回合状态整理成可追踪的 fail-closed 修复队列。</p>
        </div>
      </div>
      <div className="zhiyu-home__diagnostic-summary">
        <StatusBadge tone={diagnostics.mode === 'ready' ? 'success' : 'warning'} shape="dot">
          {diagnostics.mode}
        </StatusBadge>
        <span>{diagnostics.readyCount} ready</span>
        <span>{diagnostics.blockedCount} blocked</span>
        <span>{diagnostics.errorCount} error</span>
      </div>
      {primary ? (
        <div className="zhiyu-home__diagnostic-primary">
          <span>Primary blocker</span>
          <strong>{primary.reasonCode}</strong>
          <small>{primary.actionHint}</small>
        </div>
      ) : (
        <div className="zhiyu-home__diagnostic-primary">
          <span>Primary blocker</span>
          <strong>none</strong>
          <small>all_required_runtime_surfaces_ready</small>
        </div>
      )}
      <div className="zhiyu-home__diagnostic-list" aria-label="fail-closed diagnostic queue">
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
    case 'route':
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

function toneForCapabilityState(state: ZhiyuCapabilityRoomItemState) {
  switch (state) {
    case 'ready':
      return 'success';
    case 'denied':
    case 'revoked':
      return 'danger';
    case 'needs-setup':
    case 'unavailable':
      return 'warning';
    case 'unsupported':
      return 'info';
    case 'catalog-only':
    default:
      return 'neutral';
  }
}

function toneForOwnerState(state: ZhiyuCapabilityRoomOwnerCard['state']) {
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
