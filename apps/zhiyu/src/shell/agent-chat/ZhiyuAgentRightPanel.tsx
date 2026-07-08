import {
  AgentCenter,
  type AgentCenterAppearanceCopy,
  type AgentCenterBehaviorCopy,
  type AgentCenterRuntimeAutonomyConfigInput,
  type AgentCenterRuntimeAdapter,
  type AgentCenterRuntimeAIConfigUpsertInput,
  type AgentCenterSectionId,
  type AgentCenterStateInput,
} from '@nimiplatform/kit/features/agent-center';
import type {
  RuntimeLocalAgentIdentityInput,
} from '@nimiplatform/kit/core/sdk-contract';
import {
  AppCardSurface,
  IconToggleAction,
} from '@nimiplatform/kit/ui';
import { Globe2, X } from 'lucide-react';
import { useMemo } from 'react';
import type { ZhiyuEvidence } from '../app/evidence';
import {
  createZhiyuAgentInspectSurface,
  getZhiyuAgentAIConfig,
  getZhiyuAgentAIConfigReadiness,
  subscribeZhiyuAgentAIConfigReadiness,
  upsertZhiyuAgentAIConfig,
  type ZhiyuAgentAIConfigCallInput,
  type ZhiyuAgentRuntimeScopedBindingIdentity,
} from './agent-ai-config';
import {
  zhiyuAgentAIConfigIdentityFromRouteInput,
  zhiyuAgentAIConfigRouteInputFromEvidence,
} from '../app/agent-ai-config-route-input';
import {
  agentCenterHeaderStateLabel,
  agentCenterWorldLabel,
  partnerInitial,
} from './ZhiyuAgentChatLabels';
import { useZhiyuAgentCenterAppearanceAdapter } from './zhiyu-agent-center-appearance-adapter';
import { getZhiyuRouteModelPickerProvider } from './zhiyu-route-model-picker-provider';

export type RightPanelMode = 'agent' | 'closed';
export type VisibleRightPanelMode = Exclude<RightPanelMode, 'closed'>;
export type AgentPanelTab = AgentCenterSectionId;

type RightAgentPanelProps = {
  readonly mode: VisibleRightPanelMode;
  readonly evidence: ZhiyuEvidence;
  readonly currentPartnerName: string;
  readonly activeTab: AgentPanelTab;
  readonly onActiveTabChange: (tab: AgentPanelTab) => void;
  readonly onClose: () => void;
  readonly onOpenModelConfig: () => void;
  readonly onAvatarLaunch?: () => void;
};

const ZHIYU_AGENT_CENTER_APPEARANCE_COPY: AgentCenterAppearanceCopy = {
  appearanceTitle: '外观',
  appearanceDescription: '设置这个伙伴在聊天中的形象、背景和动态效果。',
  avatarCardTitle: '伙伴形象',
  avatarUnsetTitle: '尚未设置形象',
  avatarUnsetDescription: '导入 Live2D 或 VRM 后，这里会显示伙伴预览。',
  importLive2dButton: '导入 Live2D',
  importVrmButton: '导入 VRM',
  supportedFormatsLabel: '支持 model3.json + textures，或 .vrm 文件',
  viewSupportedFormats: '查看支持格式',
  currentAvatarPrefix: '当前形象',
  assetImported: '资源已导入',
  avatarReadyHint: '还差 1 步即可在聊天中显示',
  avatarSetupHint: '导入形象资源后即可在聊天中显示',
  avatarMissingTitle: '尚未导入形象',
  avatarImportPrimary: '导入形象资源',
  blockedScopeTitle: '请先选择本地伙伴',
  blockedScopeDescription: '形象导入需要绑定到一个具体的本地伙伴，当前还没有可写入的伙伴作用域。',
  blockedScopeHint: '先在左侧选择已有伙伴；如果没有伙伴，请到 Nimi 桌面端「探索」添加角色。',
  blockedBridgeTitle: '形象配置暂不可用',
  blockedBridgeDescription: '本地配置桥接未连接，暂时不能导入或更换形象。',
  blockedBridgeHint: '确认桌面端运行状态恢复后再重试。',
  blockedGenericTitle: '形象配置暂不可用',
  blockedGenericDescription: '当前状态无法安全写入形象配置。',
  blockedGenericHint: '稍后重试，或先切换到一个可用的本地伙伴。',
  continueSetup: '继续完成配置',
  changeAvatar: '更换形象',
  progressTitle: '让形象显示出来',
  progressCompleteLabel: '已完成',
  stepAssetTitle: '已导入形象资源',
  stepAssetReady: 'Live2D 资源已成功导入',
  stepAssetMissing: '请选择 Live2D 文件夹或 VRM 文件',
  stepValidationTitle: '已验证文件格式',
  stepValidationReady: '模型与配置文件格式正确',
  stepValidationMissing: '选择形象后会自动验证文件格式',
  stepSidecarTitle: '选择 Live2D sidecar 配置',
  stepSidecarReady: 'sidecar 配置已关联',
  stepSidecarPending: '选择 sidecar 文件以启用形象',
  stepDisplayTitle: '完成显示启用',
  stepDisplayReady: '形象已可在聊天中显示',
  stepDisplayPending: '启用后将在聊天中显示形象',
  doneLabel: '已完成',
  pendingLabel: '待完成',
  notStartedLabel: '未开始',
  selectSidecar: '选择 sidecar 文件',
  assetManagementTitle: '形象管理',
  importLive2dTitle: '导入 Live2D 文件夹',
  importLive2dSubtitle: '支持模型3.json + textures',
  live2dImported: '当前已导入',
  importVrmTitle: '导入 VRM 文件',
  importVrmSubtitle: '支持 .vrm 单个文件',
  importOtherFormat: '导入其他格式',
  removeAvatar: '移除当前形象',
  chatBackgroundTitle: '聊天背景',
  chatBackgroundDescription: '为这个伙伴设置专属背景，让对话更有氛围。',
  backgroundUnset: '尚未设置',
  backgroundReady: '已设置',
  uploadBackground: '上传背景图片',
  chooseRecommendedBackground: '选择推荐背景',
  technicalDetailsTitle: '技术详情',
  technicalDetailsDescription: '查看形象资源、配置与诊断信息',
  diagnosticsEvidenceTitle: '诊断信息',
  selectedAssetLabel: '已选择资源',
  validationLabel: '格式验证',
  capabilityProfileLabel: '能力配置',
  live2dManifestLabel: 'Live2D adapter 配置',
  linkedLabel: '已关联',
  pendingEvidenceLabel: '等待证据',
  missingLabel: '未选择',
  avatarAutoplayLabel: '形象自动启动',
  avatarAutoplayDescription: '启动交接仍由 Runtime 形象投影控制。',
  enableLabel: '启用',
  disableLabel: '停用',
  voiceArtifactsLabel: '生成语音缓存',
  voiceArtifactsDescription: '清理由 Runtime/Avatar 类型化维护动作处理。',
  cleanupLabel: '清理',
  cleaningLabel: '清理中...',
  instancePolicyLabel: '实例策略',
  generatedMotionLabel: '生成动作',
  launchModeLabel: '启动模式',
  debugProfileLabel: '调试配置',
};

const ZHIYU_AGENT_CENTER_BEHAVIOR_COPY: AgentCenterBehaviorCopy = {
  eyebrow: '主动陪伴',
  title: '让伙伴在合适的时候主动出现',
  description: '开启后，他可以在日常节奏、久未联系或重要变化时主动和你互动。',
  enableTitle: '允许主动陪伴',
  enableDescription: '关闭后，他只会在你主动发起对话时回应。',
  enabledStatus: '已开启',
  disabledStatus: '已关闭',
  modeTitle: '主动程度',
  quietTitle: '安静',
  quietDescription: '只在你开口时回应',
  occasionalTitle: '偶尔',
  occasionalDescription: '久未联系时提醒',
  dailyTitle: '日常',
  dailyDescription: '自然问候与陪伴',
  activeTitle: '活跃',
  activeDescription: '更频繁参与互动',
  budgetTitle: '主动用量保护',
  budgetDescription: '为主动陪伴设置 token 上限，避免在你没有注意时消耗过多。',
  todayUsedLabel: '今日已用',
  dailyLimitLabel: '每日上限',
  singleLimitLabel: '单次上限',
  reachedLimitLabel: '达到上限后',
  reachedLimitAction: '暂停主动陪伴',
  adjustLimitLabel: '调整用量上限',
  applyLimitLabel: '保存用量上限',
  tokensUnit: 'tokens',
  approxPrefix: '约',
  savingLabel: '正在保存主动陪伴设置。',
  savedLabel: '主动陪伴设置已保存。',
  unavailableLabel: '运行时暂时不能更新主动陪伴设置。',
};

export function RightAgentPanel(props: RightAgentPanelProps) {
  const agentCenterWorld = agentCenterWorldLabel(props.evidence);
  const appearance = useZhiyuAgentCenterAppearanceAdapter(props.evidence);
  const runtimeState = props.evidence.runtime.ready
    ? 'ready'
    : props.evidence.runtime.reasonCode === 'not-probed'
      ? 'checking'
      : 'blocked';
  const runtimeDotClass = props.evidence.runtime.ready
    ? 'bg-emerald-500'
    : runtimeState === 'checking'
      ? 'bg-sky-400'
      : 'bg-amber-500';
  const moodLabel = agentCenterHeaderStateLabel(props.evidence.companion.currentEmotion);
  const activityLabel = agentCenterHeaderStateLabel(props.evidence.companion.executionState);
  const appearanceLabel = agentCenterHeaderStateLabel(appearance.projection.status);
  const state = useMemo<AgentCenterStateInput>(() => ({
    runtimeError: props.evidence.runtime.ready ? null : `${props.evidence.runtime.reasonCode}: ${props.evidence.runtime.message}`,
    appearance: appearance.projection,
  }), [appearance.projection, props.evidence.runtime.message, props.evidence.runtime.ready, props.evidence.runtime.reasonCode]);
  const runtimeAdapter = useMemo(
    () => buildZhiyuAgentCenterRuntimeAdapter(props.evidence),
    [props.evidence],
  );

  return (
    <aside
      className="zhiyu-agent-center mr-2 my-12 flex h-[calc(100vh-96px)] min-h-0 w-[min(500px,calc(100vw-96px))] max-w-full shrink-0 [grid-area:side] max-[980px]:my-0 max-[980px]:mr-0 max-[980px]:h-auto max-[980px]:min-h-[min(640px,calc(100vh-20px))] max-[980px]:w-full"
      data-zhiyu-region="agent-panel"
      data-zhiyu-agent-center-placement="kit"
      data-zhiyu-agent-panel-mode={props.mode}
      data-zhiyu-agent-center-side-sheet="desktop"
      aria-label="Agent Center placement"
    >
      <AppCardSurface
        kind="promoted-glass"
        as="section"
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div
          className="zhiyu-agent-center__header flex items-start gap-3 border-b border-white/70 px-4 pb-2 pt-2.5"
          data-zhiyu-agent-center-header="true"
          data-zhiyu-agent-center-owner="kit-placement"
        >
          <span className="zhiyu-agent-center__avatar grid h-[52px] w-[52px] shrink-0 place-items-center rounded-[16px] border border-emerald-300/70 bg-emerald-500/20 text-[17px] font-semibold text-emerald-900 shadow-[0_0_0_3px_rgba(168,85,247,0.28)]" aria-hidden="true">
            {partnerInitial(props.currentPartnerName)}
          </span>
          <div className="zhiyu-agent-center__title min-w-0 flex-1">
            <div className="zhiyu-agent-center__eyebrow-row mb-0.5 flex min-w-0 items-center gap-3">
              <span className="block shrink-0 text-[10.5px] font-semibold uppercase text-[var(--nimi-text-muted)]" data-zhiyu-agent-center-eyebrow="AGENT CENTER">AGENT CENTER</span>
              <span
                className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full bg-white/70 px-2 text-[10.5px] font-semibold uppercase text-[var(--nimi-text-secondary)] shadow-[inset_0_0_0_1px_rgba(148,163,184,0.24)]"
                data-zhiyu-agent-center-runtime-pill={runtimeState}
                title={props.evidence.runtime.ready ? 'runtime ready' : props.evidence.runtime.message}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${runtimeDotClass}`}
                  data-zhiyu-agent-center-runtime-dot={runtimeState}
                />
                <span>runtime</span>
              </span>
            </div>
            <div className="flex min-w-0 items-center">
              <strong className="m-0 block min-w-0 truncate text-[15px] font-semibold tracking-tight text-[var(--nimi-text-primary)]">{props.currentPartnerName}</strong>
            </div>
            <div className="zhiyu-agent-center__meta mt-1 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1">
              {moodLabel ? (
                <span
                  className="inline-flex max-w-[76px] items-center truncate rounded-full bg-violet-500/10 px-1.5 py-px text-[10px] font-semibold text-violet-700"
                  data-zhiyu-agent-center-state-chip="mood"
                  title={`Mood: ${moodLabel}`}
                >
                  {moodLabel}
                </span>
              ) : null}
              {activityLabel ? (
                <span
                  className="inline-flex max-w-[76px] items-center truncate rounded-full bg-sky-500/10 px-1.5 py-px text-[10px] font-semibold text-sky-700"
                  data-zhiyu-agent-center-state-chip="activity"
                  title={`Activity: ${activityLabel}`}
                >
                  {activityLabel}
                </span>
              ) : null}
              {appearanceLabel ? (
                <span
                  className="inline-flex max-w-[92px] items-center truncate rounded-full bg-emerald-500/10 px-1.5 py-px text-[10px] font-semibold text-emerald-700"
                  data-zhiyu-agent-center-state-chip="appearance"
                  title={`Appearance: ${appearanceLabel}`}
                >
                  {appearanceLabel}
                </span>
              ) : null}
              {agentCenterWorld ? (
                <span
                  className="inline-flex min-w-0 max-w-full shrink items-center gap-1.5 text-[10.5px] font-medium text-[var(--nimi-text-secondary)]"
                  data-zhiyu-agent-center-world-name={agentCenterWorld}
                  title={agentCenterWorld}
                >
                  <Globe2
                    aria-hidden="true"
                    className="shrink-0 text-[var(--nimi-text-muted)]"
                    data-zhiyu-agent-center-world-icon="true"
                    size={12}
                  />
                  <span className="min-w-0 truncate">{agentCenterWorld}</span>
                </span>
              ) : null}
            </div>
          </div>
          <IconToggleAction
            type="button"
            aria-label="Close Agent Center"
            title="Close panel"
            data-zhiyu-agent-panel-close="true"
            onClick={props.onClose}
            icon={<X size={16} aria-hidden="true" />}
          />
        </div>
        <div
          className="zhiyu-agent-center__body grid flex-1 content-start gap-3 overflow-auto px-5 py-3"
          data-zhiyu-agent-panel-tab={props.activeTab}
          data-zhiyu-agent-center-kit-surface="true"
        >
          <AgentCenter
            ariaLabel="Zhiyu Agent Center"
            activeSection={props.activeTab}
            appearanceCopy={ZHIYU_AGENT_CENTER_APPEARANCE_COPY}
            behaviorCopy={ZHIYU_AGENT_CENTER_BEHAVIOR_COPY}
            chrome="embedded"
            onSectionChange={props.onActiveTabChange}
            placementActions={{
              close: props.onClose,
              openRuntimeSettings: props.onOpenModelConfig,
              launchAvatar: props.onAvatarLaunch,
            }}
            appearanceAdapter={appearance.adapter}
            runtimeAdapter={runtimeAdapter}
            state={state}
          />
        </div>
      </AppCardSurface>
    </aside>
  );
}

function buildZhiyuAgentCenterRuntimeAdapter(evidence: ZhiyuEvidence): AgentCenterRuntimeAdapter | null {
  const routeInput = zhiyuAgentAIConfigRouteInputFromEvidence(evidence);
  const subjectUserId = routeInput.subjectUserId.trim();
  const identity = zhiyuAgentAIConfigIdentityFromRouteInput(routeInput);
  if (!subjectUserId || !identity) {
    return null;
  }
  const callInput: ZhiyuAgentAIConfigCallInput = {
    subjectUserId,
    ...identity,
  };
  const scopedBindingIdentity = zhiyuAgentCenterScopedBindingIdentity(identity, evidence);
  const upsertWithIdentity = (input: AgentCenterRuntimeAIConfigUpsertInput) =>
    upsertZhiyuAgentAIConfig({
      ...resolveZhiyuAgentCenterMutationIdentity(callInput, input),
      subjectUserId,
      expectedRevision: input.expectedRevision,
      intents: input.intents,
    });
  const inspect = createZhiyuAgentInspectSurface(
    subjectUserId,
    scopedBindingIdentity,
  );

  return {
    inspect,
    agentAIConfig: {
      get(input = callInput) {
        return getZhiyuAgentAIConfig({
          ...resolveZhiyuAgentCenterCallIdentity(callInput, input),
          subjectUserId: input.subjectUserId || subjectUserId,
        });
      },
      readiness(input = callInput) {
        return getZhiyuAgentAIConfigReadiness({
          ...resolveZhiyuAgentCenterCallIdentity(callInput, input),
          subjectUserId: input.subjectUserId || subjectUserId,
        });
      },
      subscribeReadiness(input = callInput) {
        return subscribeZhiyuAgentAIConfigReadiness({
          ...resolveZhiyuAgentCenterCallIdentity(callInput, input),
          subjectUserId: input.subjectUserId || subjectUserId,
        });
      },
      upsert(input) {
        return upsertZhiyuAgentAIConfig({
          ...resolveZhiyuAgentCenterCallIdentity(callInput, input),
          subjectUserId: input.subjectUserId || subjectUserId,
          expectedRevision: input.expectedRevision,
          intents: input.intents,
        });
      },
    },
    modelConfig: {
      providerResolver: getZhiyuRouteModelPickerProvider,
    },
    async loadSnapshot() {
      const [agentAIConfig, readiness, publicInspect] = await Promise.all([
        getZhiyuAgentAIConfig(callInput),
        getZhiyuAgentAIConfigReadiness(callInput),
        inspect.getPublicInspect(identity),
      ]);
      return {
        agentAIConfig,
        readiness,
        inspect: publicInspect,
      };
    },
    upsertAgentAIConfig: upsertWithIdentity,
    setAutonomyConfig(input) {
      return inspect.setAutonomyConfig({
        ...resolveZhiyuAgentCenterAutonomyIdentity(callInput, input),
        mode: input.enabled === false ? 'off' : input.mode,
        dailyTokenBudget: input.dailyTokenBudget,
        maxTokensPerHook: input.maxTokensPerHook,
      });
    },
  };
}

function zhiyuAgentCenterScopedBindingIdentity(
  identity: RuntimeLocalAgentIdentityInput,
  evidence: ZhiyuEvidence,
): ZhiyuAgentRuntimeScopedBindingIdentity | null {
  const ownerUserId = typeof identity.ownerUserId === 'string' ? identity.ownerUserId.trim() : '';
  const runtimeSourceRef = typeof identity.runtimeSourceRef === 'string' ? identity.runtimeSourceRef.trim() : '';
  const localAgentRef = typeof identity.localAgentRef === 'string' ? identity.localAgentRef.trim() : '';
  const conversationAnchorId = evidence.conversation.conversationAnchorId?.trim() || '';
  if (!ownerUserId || !runtimeSourceRef || !localAgentRef || !conversationAnchorId) {
    return null;
  }
  return {
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
    conversationAnchorId,
  };
}

function resolveZhiyuAgentCenterMutationIdentity(
  base: ZhiyuAgentAIConfigCallInput,
  input: AgentCenterRuntimeAIConfigUpsertInput,
): RuntimeLocalAgentIdentityInput {
  if (input.ownerUserId && input.runtimeSourceRef && input.localAgentRef) {
    return {
      ownerUserId: input.ownerUserId,
      runtimeSourceRef: input.runtimeSourceRef,
      localAgentRef: input.localAgentRef,
      ...(input.scopedBinding ? { scopedBinding: input.scopedBinding } : {}),
    };
  }
  return resolveZhiyuAgentCenterCallIdentity(base, base);
}

function resolveZhiyuAgentCenterAutonomyIdentity(
  base: ZhiyuAgentAIConfigCallInput,
  input: AgentCenterRuntimeAutonomyConfigInput,
): RuntimeLocalAgentIdentityInput {
  if (input.ownerUserId && input.runtimeSourceRef && input.localAgentRef) {
    return {
      ownerUserId: input.ownerUserId,
      runtimeSourceRef: input.runtimeSourceRef,
      localAgentRef: input.localAgentRef,
      ...(input.scopedBinding ? { scopedBinding: input.scopedBinding } : {}),
    };
  }
  return resolveZhiyuAgentCenterCallIdentity(base, base);
}

function resolveZhiyuAgentCenterCallIdentity(
  base: ZhiyuAgentAIConfigCallInput,
  input: Partial<RuntimeLocalAgentIdentityInput>,
): RuntimeLocalAgentIdentityInput {
  return {
    ownerUserId: input.ownerUserId || base.ownerUserId,
    runtimeSourceRef: input.runtimeSourceRef || base.runtimeSourceRef,
    localAgentRef: input.localAgentRef || base.localAgentRef,
    ...(input.scopedBinding || base.scopedBinding ? { scopedBinding: input.scopedBinding || base.scopedBinding } : {}),
  };
}
