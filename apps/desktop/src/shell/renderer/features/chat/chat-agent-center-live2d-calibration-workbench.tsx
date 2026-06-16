import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';
import type { AgentCenterAvatarAssetModule } from './chat-agent-center-avatar-config-types';
import {
  AvatarDebugProbeKind,
  avatarDebugProbeStatusLabel,
} from './chat-agent-center-avatar-debug-workbench-model';
import {
  buildLive2dCalibrationWorkbenchModel,
  type Live2dCalibrationWorkbenchItem,
  type Live2dCalibrationWorkbenchItemStatus,
} from './chat-agent-center-live2d-calibration-workbench-model';

type AgentCenterLive2dCalibrationWorkbenchProps = {
  input: UseAgentConversationPresentationInput;
  avatarAssetConfig: AgentCenterAvatarAssetModule | null;
  avatarAssetValid: boolean;
  avatarAssetChecking: boolean;
};

function statusTone(status: Live2dCalibrationWorkbenchItemStatus): string {
  if (status === 'ready') {
    return 'border-emerald-100 bg-emerald-50 text-emerald-700';
  }
  if (status === 'probe_required' || status === 'checking') {
    return 'border-amber-100 bg-amber-50 text-amber-700';
  }
  if (status === 'not_admitted' || status === 'effect_projection_pending') {
    return 'border-sky-100 bg-sky-50 text-sky-700';
  }
  if (status === 'blocked') {
    return 'border-rose-100 bg-rose-50 text-rose-700';
  }
  return 'border-slate-100 bg-slate-50 text-slate-500';
}

function itemLabel(input: UseAgentConversationPresentationInput, item: Live2dCalibrationWorkbenchItem): string {
  switch (item.id) {
    case 'preview_artifact':
      return input.t('Chat.agentCenterLive2dWorkbenchPreviewArtifact', { defaultValue: 'Preview artifact' });
    case 'model_framing':
      return input.t('Chat.agentCenterLive2dWorkbenchModelFraming', { defaultValue: 'Model framing' });
    case 'render_policy':
      return input.t('Chat.agentCenterLive2dWorkbenchRenderPolicy', { defaultValue: 'Render policy' });
    case 'expression_inventory':
      return input.t('Chat.agentCenterLive2dWorkbenchExpressionInventory', { defaultValue: 'Expression inventory' });
    case 'adapter_manifest':
      return input.t('Chat.agentCenterLive2dWorkbenchAdapterManifest', { defaultValue: 'Adapter manifest' });
    default:
      return item.id;
  }
}

function statusLabel(input: UseAgentConversationPresentationInput, status: Live2dCalibrationWorkbenchItemStatus): string {
  switch (status) {
    case 'ready':
      return input.t('Chat.agentCenterLive2dWorkbenchReady', { defaultValue: 'Ready' });
    case 'checking':
      return input.t('Chat.agentCenterLive2dWorkbenchChecking', { defaultValue: 'Checking' });
    case 'blocked':
      return input.t('Chat.agentCenterLive2dWorkbenchBlocked', { defaultValue: 'Blocked' });
    case 'missing':
      return input.t('Chat.agentCenterLive2dWorkbenchMissing', { defaultValue: 'Missing' });
    case 'probe_required':
      return input.t('Chat.agentCenterLive2dWorkbenchProbeRequired', { defaultValue: 'Probe required' });
    case 'not_admitted':
      return input.t('Chat.agentCenterLive2dWorkbenchNotAdmitted', { defaultValue: 'Not admitted' });
    case 'effect_projection_pending':
      return input.t('Chat.agentCenterLive2dWorkbenchEffectProjectionPending', { defaultValue: 'Effect pending' });
    default:
      return status;
  }
}

function detailLabel(input: UseAgentConversationPresentationInput, item: Live2dCalibrationWorkbenchItem): string {
  switch (item.detailCode) {
    case 'runtime_backend_or_window_probe_required':
      return input.t('Chat.agentCenterLive2dWorkbenchPreviewProbeRequired', { defaultValue: 'Review through Runtime backend or window probe evidence.' });
    case 'runtime_emotion_probe_required':
      return input.t('Chat.agentCenterLive2dWorkbenchExpressionProbeRequired', { defaultValue: 'Review through Runtime emotion probe evidence.' });
    case 'calibration_effect_projection_pending':
      return input.t('Chat.agentCenterLive2dWorkbenchCalibrationEffectBlocked', { defaultValue: 'Calibration ref is projected as evidence; Avatar effect waits for payload/effect projection.' });
    case 'backend_capability_profile_ref_required':
      return input.t('Chat.agentCenterLive2dWorkbenchProfileRequired', { defaultValue: 'Backend capability profile evidence is required.' });
    case 'external_sidecar_ref_selected':
      return input.t('Chat.agentCenterLive2dWorkbenchExternalSidecar', { defaultValue: 'External sidecar ref is selected.' });
    case 'embedded_creator_manifest_selected':
      return input.t('Chat.agentCenterLive2dWorkbenchEmbeddedManifest', { defaultValue: 'Embedded creator manifest is selected.' });
    case 'adapter_manifest_not_selected':
      return input.t('Chat.agentCenterLive2dWorkbenchNoAdapterManifest', { defaultValue: 'No adapter manifest is selected.' });
    case 'local_asset_or_capability_evidence_required':
    default:
      return input.t('Chat.agentCenterLive2dWorkbenchEvidenceRequired', { defaultValue: 'Local asset and capability evidence are required.' });
  }
}

function probeLabel(probeKind: AvatarDebugProbeKind): string {
  switch (probeKind) {
    case AvatarDebugProbeKind.BACKEND_LOAD:
      return 'Backend';
    case AvatarDebugProbeKind.CAPABILITY_PROFILE:
      return 'Profile';
    case AvatarDebugProbeKind.ROUTE_SUPPORT_MATRIX:
      return 'Routes';
    case AvatarDebugProbeKind.GENERATED_MOTION:
      return 'Motion';
    case AvatarDebugProbeKind.EMOTION_EXPRESSION:
      return 'Emotion';
    case AvatarDebugProbeKind.SPEECH_LIPSYNC:
      return 'Speech';
    case AvatarDebugProbeKind.WINDOW_HIT_REGION:
      return 'Window';
    default:
      return avatarDebugProbeStatusLabel(undefined);
  }
}

function ReviewItem(props: {
  input: UseAgentConversationPresentationInput;
  item: Live2dCalibrationWorkbenchItem;
}) {
  const { input, item } = props;
  return (
    <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[11px] font-semibold text-slate-800">
            {itemLabel(input, item)}
          </div>
          <div className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-500">
            {detailLabel(input, item)}
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusTone(item.status)}`}>
          {statusLabel(input, item.status)}
        </span>
      </div>
      {item.evidenceRef ? (
        <div className="mt-2 truncate text-[10px] leading-4 text-slate-400">
          {input.t('Chat.agentCenterLive2dWorkbenchEvidenceRef', { defaultValue: 'Evidence ref' })}: {item.evidenceRef}
        </div>
      ) : null}
    </div>
  );
}

export function AgentCenterLive2dCalibrationWorkbench(
  props: AgentCenterLive2dCalibrationWorkbenchProps,
) {
  const model = buildLive2dCalibrationWorkbenchModel({
    config: props.avatarAssetConfig,
    avatarAssetValid: props.avatarAssetValid,
    avatarAssetChecking: props.avatarAssetChecking,
  });
  if (!model.visible) {
    return null;
  }

  const adapterSourceLabel = model.adapterManifestSource === 'external_sidecar_manifest'
    ? props.input.t('Chat.agentCenterLive2dAdapterSidecarLinked', { defaultValue: 'External sidecar linked' })
    : model.adapterManifestSource === 'embedded_creator_manifest'
      ? props.input.t('Chat.agentCenterLive2dAdapterEmbedded', { defaultValue: 'Embedded' })
      : props.input.t('Chat.agentCenterLive2dAdapterNone', { defaultValue: 'Not selected' });

  return (
    <section
      className="rounded-xl border border-sky-100 bg-sky-50/35 px-3 py-3"
      data-testid="agent-center-live2d-calibration-workbench"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-slate-950">
            {props.input.t('Chat.agentCenterLive2dCalibrationWorkbench', { defaultValue: 'Live2D workbench' })}
          </div>
          <div className="mt-1 text-[11px] leading-4 text-slate-500">
            {props.input.t('Chat.agentCenterLive2dWorkbenchSource', {
              defaultValue: 'Asset {{assetRef}} · {{adapterSource}}',
              assetRef: model.assetRef || props.input.t('Chat.agentCenterMissing', { defaultValue: 'Missing' }),
              adapterSource: adapterSourceLabel,
            })}
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
          model.launchEvidenceReady ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
        }`}
        >
          {model.launchEvidenceReady
            ? props.input.t('Chat.agentCenterLive2dWorkbenchEvidenceReady', { defaultValue: 'Evidence ready' })
            : props.input.t('Chat.agentCenterLive2dWorkbenchEvidencePending', { defaultValue: 'Evidence pending' })}
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {model.reviewItems.map((item) => (
          <ReviewItem key={item.id} input={props.input} item={item} />
        ))}
      </div>

      <div className="mt-3 rounded-lg border border-white/70 bg-white/70 px-3 py-2">
        <div className="text-[10px] font-semibold uppercase text-slate-500">
          {props.input.t('Chat.agentCenterLive2dWorkbenchProbeShortcuts', { defaultValue: 'Debug probe shortcuts' })}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {model.debugProbeShortcutKinds.map((probeKind) => (
            <span
              key={probeKind}
              className="rounded-full border border-sky-100 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700"
            >
              {probeLabel(probeKind)}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] leading-4 text-slate-600">
        {model.calibrationRef ? (
          <div className="mb-1 truncate text-[10px] font-semibold text-slate-500">
            {props.input.t('Chat.agentCenterLive2dWorkbenchCalibrationRef', { defaultValue: 'Calibration ref' })}: {model.calibrationRef}
          </div>
        ) : null}
        {props.input.t('Chat.agentCenterLive2dWorkbenchPersistenceBlocked', {
          defaultValue: 'Desktop stores only the opaque calibration ref. Avatar can read the ref as evidence, but framing, scale, FPS, model digest, expression inventory, preview refs, and Avatar effect still wait for payload/effect projection.',
        })}
      </div>
    </section>
  );
}
