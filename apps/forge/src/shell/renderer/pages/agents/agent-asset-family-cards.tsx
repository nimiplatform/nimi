import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import { ForgeEntityAvatar } from '@renderer/components/card-list.js';
import { formatDate } from '@renderer/components/format-utils.js';
import { ForgeStatusBadge } from '@renderer/components/status-indicators.js';
import type { DesignedVoiceAsset } from '@renderer/data/enrichment-client.js';
import type { ResourceSummary } from '@renderer/hooks/use-content-queries.js';
import type { AgentAssetOpsCandidateView, AgentAssetOpsFamily } from '@renderer/hooks/use-agent-asset-ops.js';


export function CandidateCard({
  candidate,
  family,
  agentName,
  highlighted,
  onAdoptCurrent,
  onReview,
  onApprove,
  onReject,
  onConfirm,
  onBind,
  bindingBusy,
  bindSupported,
}: {
  candidate: AgentAssetOpsCandidateView;
  family: AgentAssetOpsFamily;
  agentName: string;
  highlighted: boolean;
  onAdoptCurrent: () => void;
  onReview: () => void;
  onApprove: () => void;
  onReject: () => void;
  onConfirm: () => void;
  onBind: () => void;
  bindingBusy: boolean;
  bindSupported: boolean;
}) {
  return (
    <Surface
      tone="card"
      material={highlighted ? 'glass-regular' : 'glass-thin'}
      elevation={highlighted ? 'raised' : 'base'}
      padding="md"
      className="space-y-4"
    >
      {candidate.previewUrl ? (
        family === 'agent-voice-demo' ? (
          <audio controls className="w-full">
            <source src={candidate.previewUrl} />
          </audio>
        ) : (
          <img
            src={candidate.previewUrl}
            alt=""
            className={`w-full rounded-[var(--nimi-radius-md)] object-cover ${family === 'agent-cover' ? 'aspect-[9/16]' : 'aspect-square'}`}
          />
        )
      ) : candidate.text ? (
        <Surface tone="card" material="glass-thin" elevation="base" padding="md" className="min-h-36">
          <p className="text-sm leading-6 text-[var(--nimi-text-primary)]">{candidate.text}</p>
        </Surface>
      ) : (
        <div className={`flex items-center justify-center rounded-[var(--nimi-radius-md)] border border-dashed border-[var(--nimi-border-subtle)] ${family === 'agent-cover' ? 'aspect-[9/16]' : 'aspect-square'}`}>
          <ForgeEntityAvatar name={agentName} size="lg" />
        </div>
      )}
      <div className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
              {candidate.resourceId
                ? `Resource ${candidate.resourceId.slice(0, 8)}`
                : candidate.text
                  ? candidate.text.slice(0, 36)
                  : candidate.id}
            </p>
            <p className="text-xs text-[var(--nimi-text-muted)]">
              Updated {formatDate(candidate.updatedAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {highlighted ? (
              <ForgeStatusBadge domain="generic" status="PRESENT" label="Library Handoff" tone="info" />
            ) : null}
            <ForgeStatusBadge
              domain="generic"
              status={candidate.effectiveLifecycle.toUpperCase()}
              label={candidate.effectiveLifecycle}
              tone={LIFECYCLE_TONE[candidate.effectiveLifecycle]}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {candidate.isSynthetic && (family === 'agent-avatar' || family === 'agent-greeting-primary') ? (
            <>
              <Button tone="primary" size="sm" onClick={onAdoptCurrent}>
                Adopt Current
              </Button>
              <Button tone="ghost" size="sm" disabled>
                Current Truth
              </Button>
            </>
          ) : null}
          {!candidate.isSynthetic || (family !== 'agent-avatar' && family !== 'agent-greeting-primary') ? (
            <>
          {candidate.effectiveLifecycle === 'generated' || candidate.effectiveLifecycle === 'rejected' || candidate.effectiveLifecycle === 'superseded' ? (
            <Button tone="ghost" size="sm" onClick={onReview}>
              Return to Review
            </Button>
          ) : (
            <Button tone="ghost" size="sm" disabled>
              Review Ready
            </Button>
          )}
          {candidate.effectiveLifecycle === 'candidate' ? (
            <Button tone="secondary" size="sm" onClick={onApprove}>
              Approve
            </Button>
          ) : (
            <Button tone="secondary" size="sm" disabled>
              Approve
            </Button>
          )}
          {candidate.effectiveLifecycle === 'candidate' || candidate.effectiveLifecycle === 'approved' ? (
            <Button tone="ghost" size="sm" onClick={onReject}>
              Reject
            </Button>
          ) : (
            <Button tone="ghost" size="sm" disabled>
              Reject
            </Button>
          )}
          {candidate.effectiveLifecycle === 'approved' ? (
            <Button tone="secondary" size="sm" onClick={onConfirm}>
              Confirm
            </Button>
          ) : candidate.effectiveLifecycle === 'confirmed' ? (
            <Button tone="primary" size="sm" onClick={onBind} disabled={bindingBusy || !bindSupported}>
              {bindingBusy ? 'Binding...' : 'Bind'}
            </Button>
          ) : candidate.effectiveLifecycle === 'bound' ? (
            <Button tone="primary" size="sm" disabled>
              Bound
            </Button>
          ) : (
            <Button tone="secondary" size="sm" disabled>
              Confirm
            </Button>
          )}
            </>
          ) : null}
        </div>
        <p className="text-xs text-[var(--nimi-text-muted)]">
          {candidate.isSynthetic
            ? 'This row was synthesized from current truth because the active winner was not yet present in local candidate state.'
            : `Origin: ${candidate.origin}. Candidate id ${candidate.id}.`}
        </p>
      </div>
    </Surface>
  );
}
export function LibraryCard({
  family,
  resource,
  onQueue,
}: {
  family: Exclude<AgentAssetOpsFamily, 'agent-greeting-primary'>;
  resource: ResourceSummary;
  onQueue: () => void;
}) {
  return (
    <Surface tone="card" material="glass-thin" elevation="base" padding="md" className="space-y-4">
      {resource.url ? (
        family === 'agent-voice-demo' ? (
          <audio controls className="w-full">
            <source src={resource.url} />
          </audio>
        ) : (
          <img
            src={resource.url}
            alt={resource.title || resource.label || resource.id}
            className={`w-full rounded-[var(--nimi-radius-md)] object-cover ${family === 'agent-cover' ? 'aspect-[9/16]' : 'aspect-square'}`}
          />
        )
      ) : null}
      <div>
        <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
          {resource.title || resource.label || `Resource ${resource.id.slice(0, 8)}`}
        </p>
        <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
          Updated {formatDate(resource.updatedAt)}
        </p>
      </div>
      <Button tone="secondary" size="sm" onClick={onQueue}>
        Queue Candidate
      </Button>
    </Surface>
  );
}
export function DesignedVoiceAssetCard({
  asset,
  selected,
  onSelect,
}: {
  asset: DesignedVoiceAsset;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Surface
      tone="card"
      material={selected ? 'glass-regular' : 'glass-thin'}
      elevation={selected ? 'raised' : 'base'}
      padding="md"
      className="space-y-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {formatDesignedVoiceLabel(asset)}
          </p>
          <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
            Target model {asset.targetModelId || asset.modelId || 'unknown'}
          </p>
        </div>
        <ForgeStatusBadge
          domain="generic"
          status={asset.status === 'ACTIVE' ? 'BOUND' : 'MISSING'}
          label={asset.status}
          tone={asset.status === 'ACTIVE' ? 'success' : 'warning'}
        />
      </div>
      <div className="space-y-1 text-xs text-[var(--nimi-text-muted)]">
        <p>Voice asset {asset.voiceAssetId.slice(0, 8)}</p>
        {asset.providerVoiceRef ? <p>Provider ref {asset.providerVoiceRef}</p> : null}
        <p>Updated {asset.updatedAt ? formatDate(asset.updatedAt) : 'Unknown'}</p>
      </div>
      <Button tone={selected ? 'primary' : 'secondary'} size="sm" onClick={onSelect}>
        {selected ? 'Selected for Synthesis' : 'Use for Synthesis'}
      </Button>
    </Surface>
  );
}
export function LifecycleCounter({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <Surface tone="card" material="glass-thin" elevation="base" padding="sm">
      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--nimi-text-muted)]">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold text-[var(--nimi-text-primary)]">{value}</p>
    </Surface>
  );
}
