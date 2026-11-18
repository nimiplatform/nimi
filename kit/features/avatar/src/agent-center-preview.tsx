import type { ReactNode } from 'react';
import { AvatarStage } from './components/avatar-stage.js';
import { createAvatarStageSnapshot } from './headless.js';
import type { AvatarStageSize } from './types.js';
import type { AgentCenterAvatarPreviewServiceResult } from './agent-center-preview-result.js';

export interface AgentCenterAvatarPreviewProps {
  readonly result: AgentCenterAvatarPreviewServiceResult;
  readonly label: string;
  readonly size?: AvatarStageSize;
  readonly className?: string;
  readonly fallback?: ReactNode;
}

export function AgentCenterAvatarPreview({
  result,
  label,
  size = 'lg',
  className,
  fallback = null,
}: AgentCenterAvatarPreviewProps) {
  if (result.state !== 'ready') {
    return (
      <div
        className={className}
        data-avatar-preview-state={result.state}
        data-avatar-preview-tier="avatar_preview_service"
        data-avatar-preview-reason={result.reason}
      >
        {fallback}
      </div>
    );
  }
  return (
    <div
      className={className}
      data-avatar-preview-state="ready"
      data-avatar-preview-tier={result.tier}
      data-avatar-preview-backend-kind={result.backendKind}
    >
      <AvatarStage
        imageUrl={result.previewImageRef}
        label={label}
        showStatusBadge={false}
        size={size}
        snapshot={createAvatarStageSnapshot({
          backendKind: result.backendKind,
          avatarAssetRef: result.avatarAssetRef,
          expressionProfileRef: null,
          idlePreset: null,
          interactionPolicyRef: null,
          defaultVoiceReference: null,
        })}
      />
    </div>
  );
}
