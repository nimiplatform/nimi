import { Button, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import { createAvatarStageSnapshot } from '@nimiplatform/kit/features/avatar/headless';
import { AvatarStage } from '@nimiplatform/kit/features/avatar/ui';
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

export function formatProjectionValue(value: string | null | undefined): string {
  if (!value || value === 'not_projected') {
    return '等待投影';
  }
  if (value === 'not_admitted') {
    return '尚未准入';
  }
  return value;
}

export function formatReasonLabel(ready: boolean, reasonCode: string): string {
  if (ready) {
    return '已就绪';
  }
  if (/missing|required|unavailable|blocked|not[_-]projected|not[_-]admitted/i.test(reasonCode)) {
    return '等待上游投影';
  }
  if (/failed|error|denied|revoked/i.test(reasonCode)) {
    return '需要处理';
  }
  return '同步中';
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
  const backendKind = avatar.backendKind ?? 'live2d';
  const avatarSnapshot = createAvatarStageSnapshot({
    backendKind,
    avatarAssetRef: `fallback://zhiyu-avatar-${avatar.ready ? 'projected' : 'blocked'}`,
    expressionProfileRef: null,
    idlePreset: null,
    interactionPolicyRef: null,
    defaultVoiceReference: null,
  }, {
    phase: avatar.ready ? 'idle' : 'transitioning',
    emotion: avatar.ready ? 'calm' : 'concerned',
    attentionTarget: 'camera',
    actionCue: avatar.ready ? 'projected' : 'blocked',
  });
  const controlState = avatar.launchAvailable || avatar.manageAvailable ? 'authorized' : 'blocked';
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
        <AvatarStage
          snapshot={avatarSnapshot}
          label="知遇 Avatar"
          fallbackLabel="知"
          statusLabel={avatar.ready ? 'Projected' : 'Blocked'}
          size="md"
          showStatusBadge
          className="zhiyu-home__avatar-stage"
        />
        <div className="zhiyu-home__avatar-copy">
          <div className="zhiyu-home__avatar-summary">
            <StatusBadge tone={avatar.ready ? 'success' : 'warning'} shape="dot">
              {avatar.ready ? 'Avatar projection ready' : 'Avatar blocked'}
            </StatusBadge>
            <span>{formatReasonLabel(avatar.ready, avatar.reasonCode)}</span>
          </div>
          <p>{avatar.ready ? avatar.message : 'Avatar 启动和管理只在 Runtime/Avatar facade 投影明确授权后出现。'}</p>
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
                Launch Avatar
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
                Manage Avatar
              </Button>
            ) : null}
            {!avatar.launchAvailable && !avatar.manageAvailable ? (
              <span data-zhiyu-avatar-actions-hidden="true">
                Launch / manage controls hidden until facade authorization.
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="zhiyu-home__avatar-grid" aria-label="Avatar facade projection">
        <AvatarPresenceField label="Projection" value={avatar.projectionRef} />
        <AvatarPresenceField label="Configuration" value={avatar.configurationRef} />
        <AvatarPresenceField label="Backend" value={avatar.backendKind} />
        <AvatarPresenceField label="Visual" value={avatar.visualReadiness} />
        <AvatarPresenceField label="Voice" value={avatar.voiceReadiness} />
        <AvatarPresenceField label="Source" value={avatar.source} />
      </div>
      <p className="zhiyu-home__action-hint">{avatar.actionHint}</p>
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
          {identityFloor.summaryReasonCode}
        </StatusBadge>
        <span>{identityFloor.readyCount} ready</span>
        <span>{identityFloor.blockedCount} blocked</span>
        <span>{identityFloor.notAdmittedCount} not admitted</span>
      </div>
      <p
        className="zhiyu-home__identity-note"
        data-zhiyu-identity-overwrite-policy="runtime-owned"
      >
        Identity cannot be overwritten by one message or by a stored memory conflict.
      </p>
      <div className="zhiyu-home__identity-grid" aria-label="identity floor projection">
        {identityFloor.items.map((item) => (
          <IdentityFloorItemRow key={item.key} item={item} />
        ))}
      </div>
      <div className="zhiyu-home__identity-unsupported" aria-label="identity floor unsupported projections">
        {identityFloor.unsupportedProjectionFields.map((field) => (
          <span
            key={field}
            data-zhiyu-identity-unsupported-field={field}
            data-zhiyu-identity-unsupported-state="not_admitted"
          >
            {field}: not_admitted
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
        {item.reasonCode}
      </StatusBadge>
    </div>
  );
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
          <p>只读展示 canonical capability catalog、Runtime/SDK route projection 与尚未准入的记忆使用边界。</p>
        </div>
      </div>
      <div className="zhiyu-home__capability-summary">
        <StatusBadge tone={capabilityRoom.routeReady ? 'success' : 'warning'} shape="dot">
          {capabilityRoom.routeReasonCode}
        </StatusBadge>
        <span>{capabilityRoom.catalogCount} canonical capabilities</span>
        <span>{capabilityRoom.deferredCount} deferred runtime aliases</span>
        <span>{capabilityRoom.executionBindingLabel}</span>
      </div>
      <div className="zhiyu-home__owner-grid" aria-label="能力边界 owner">
        {capabilityRoom.owners.map((owner) => (
          <OwnerCard key={owner.key} owner={owner} />
        ))}
      </div>
      <div className="zhiyu-home__capability-list" aria-label="canonical capability catalog">
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
            <div>
              <strong>{item.capabilityId}</strong>
              <small>{item.section} / {item.runtimeEvidenceClass}</small>
              <div
                className="zhiyu-home__capability-governance"
                data-zhiyu-capability-governance-owner={item.governance.owner}
                data-zhiyu-capability-governance-data-movement={item.governance.dataMovement}
                data-zhiyu-capability-governance-retention={item.governance.retention}
                data-zhiyu-capability-governance-revocation={item.governance.revocation}
                data-zhiyu-capability-governance-audit-source={item.governance.auditSource}
                data-zhiyu-capability-governance-source={item.governance.source}
              >
                <span>{item.matrix.currentState}</span>
                <span>{item.governance.owner}</span>
                <span>{item.governance.dataMovement}</span>
                <span>{item.governance.retention}</span>
                <span>{item.matrix.revocationPath}</span>
                <span>{item.matrix.auditSource}</span>
                <span>{item.matrix.auditRef}</span>
                <span>{item.matrix.unsupportedReason}</span>
                <span>{item.matrix.setupRequirement}</span>
              </div>
            </div>
            <StatusBadge tone={toneForCapabilityState(item.state)} shape="dot">
              {item.active ? item.reasonCode : item.state}
            </StatusBadge>
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
      <strong>{owner.owner}</strong>
      <StatusBadge tone={toneForOwnerState(owner.state)} shape="dot">
        {owner.reasonCode}
      </StatusBadge>
    </div>
  );
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

export function HiddenEvidenceStatus({ evidence }: { readonly evidence: ZhiyuEvidence }) {
  return (
    <div className="zhiyu-home__evidence" aria-hidden="true">
      <p
        data-zhiyu-runtime-state={evidence.runtime.reasonCode}
        data-zhiyu-runtime-source={evidence.runtime.source}
      />
      <p
        data-zhiyu-auth-state={evidence.auth.reasonCode}
        data-zhiyu-auth-source={evidence.auth.source}
        data-zhiyu-auth-ready={String(evidence.auth.ready)}
      />
      <p
        data-zhiyu-source-state={evidence.source.reasonCode}
        data-zhiyu-source-source={evidence.source.source}
        data-zhiyu-source-ready={String(evidence.source.ready)}
      />
      <p
        data-zhiyu-agent-inventory-state={evidence.inventory.reasonCode}
        data-zhiyu-agent-inventory-source={evidence.inventory.source}
        data-zhiyu-agent-inventory-ready={String(evidence.inventory.ready)}
        data-zhiyu-agent-inventory-count={String(evidence.inventory.count)}
      />
      <p
        data-zhiyu-local-agent-state={evidence.localAgent.reasonCode}
        data-zhiyu-local-agent-source={evidence.localAgent.source}
        data-zhiyu-local-agent-ready={String(evidence.localAgent.ready)}
      />
      <p
        data-zhiyu-image-studio-state={evidence.imageStudio.state}
        data-zhiyu-image-studio-reason={evidence.imageStudio.reasonCode}
        data-zhiyu-image-studio-ready={String(evidence.imageStudio.ready)}
        data-zhiyu-image-studio-artifact-count={String(evidence.imageStudio.artifactCount)}
        data-zhiyu-image-studio-preview-source={evidence.imageStudio.firstArtifact?.previewSource ?? 'none'}
      />
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
