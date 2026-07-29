import {
  AgentCenter,
  type AgentCenterAppearanceAdapter,
  type AgentCenterAppearanceCopy,
  type AgentCenterAppearanceProjection,
  type AgentCenterBehaviorCopy,
  type AgentCenterCopy,
  type AgentCenterRuntimeAdapter,
  type AgentCenterSectionId,
  type AgentCenterStateInput,
} from '@nimiplatform/kit/features/agent-center';
import {
  AppCardSurface,
  IconToggleAction,
} from '@nimiplatform/kit/ui';
import { Globe2, X } from 'lucide-react';
import { useMemo } from 'react';
import type { ZhiyuEvidence } from '../app/evidence';
import {
  agentCenterHeaderStateLabel,
  agentCenterWorldLabel,
  chatBlockedHint,
  partnerInitial,
} from './ZhiyuAgentChatLabels';

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
  readonly onOpenDesktopAgentConfig: () => void;
  readonly onAvatarLaunch?: () => void;
  readonly appearanceAdapter: AgentCenterAppearanceAdapter;
  readonly runtimeAdapter: AgentCenterRuntimeAdapter | null;
};

const ZHIYU_AGENT_CENTER_APPEARANCE_COPY: AgentCenterAppearanceCopy = {
  appearanceTitle: '外观',
  appearanceDescription: '设置这个伙伴在聊天中的形象和背景。',
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
  stepSidecarTitle: '选择 Live2D 旁路配置',
  stepSidecarReady: '旁路配置已关联',
  stepSidecarPending: '选择旁路配置文件以启用形象',
  stepDisplayTitle: '完成显示启用',
  stepDisplayReady: '形象已可在聊天中显示',
  stepDisplayPending: '启用后将在聊天中显示形象',
  doneLabel: '已完成',
  pendingLabel: '待完成',
  notStartedLabel: '未开始',
  selectSidecar: '选择旁路配置文件',
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
  live2dManifestLabel: 'Live2D 适配器配置',
  linkedLabel: '已关联',
  pendingEvidenceLabel: '等待证据',
  missingLabel: '未选择',
  avatarAutoplayLabel: '形象自动启动',
  avatarAutoplayDescription: '启动交接仍由运行时形象投影控制。',
  enableLabel: '启用',
  disableLabel: '停用',
  voiceArtifactsLabel: '生成语音缓存',
  voiceArtifactsDescription: '清理由运行时/形象类型化维护动作处理。',
  cleanupLabel: '清理',
  cleaningLabel: '清理中...',
  appearanceUpdateFailed: '运行时外观更新失败。',
  live2dStatusProbeRequired: '需要检查',
  live2dStatusNotAdmitted: '尚未准入',
  live2dStatusEffectPending: '效果待投影',
  live2dStatusChecking: '检查中',
  live2dStatusReady: '就绪',
  live2dStatusPending: '等待中',
  live2dStatusMissing: '缺失',
  live2dStatusBlocked: '受阻',
  live2dPreviewOutputLabel: '渲染预览',
  live2dModelFramingLabel: '模型构图',
  live2dRenderPolicyLabel: '渲染策略',
  live2dExpressionInventoryLabel: '表情清单',
  live2dAdapterManifestEvidenceLabel: '适配器配置',
  live2dEvidenceRequired: '需要本地资源和后端能力证据。',
  live2dPreviewReadyDetail: 'Avatar 渲染器已产生可见且非占位的输出。',
  live2dCalibrationPendingDetail: '校准引用已作为证据投影，形象效果等待载荷与效果投影。',
  live2dEmotionReadyDetail: '通过运行时情绪检查证据复核。',
  live2dBackendRequiredDetail: '需要后端能力配置证据。',
  live2dExternalSidecarSelected: '已选择外部旁路配置引用。',
  live2dEmbeddedManifestSelected: '已选择内置创作者配置。',
  live2dNoAdapterManifestSelected: '尚未选择适配器配置。',
  evidenceRefLabel: '证据引用',
  calibrationRefLabel: '校准引用',
  custodyNotice: '此界面只保存不透明的形象/运行时引用；模型摘要、构图、缩放、帧率、表情清单、预览引用与效果物化由形象和运行时负责。',
  adapterUnavailableFormat: '{{label}} 适配器暂不可用。',
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
  budgetDescription: '为主动陪伴设置令牌上限，避免在你没有注意时消耗过多。',
  todayUsedLabel: '今日已用',
  dailyLimitLabel: '每日上限',
  singleLimitLabel: '单次上限',
  reachedLimitLabel: '达到上限后',
  reachedLimitAction: '暂停主动陪伴',
  adjustLimitLabel: '调整用量上限',
  applyLimitLabel: '保存用量上限',
  tokensUnit: '令牌',
  approxPrefix: '约',
  savingLabel: '正在保存主动陪伴设置。',
  savedLabel: '主动陪伴设置已保存。',
  unavailableLabel: '运行时暂时不能更新主动陪伴设置。',
};

const ZHIYU_AGENT_CENTER_COPY: AgentCenterCopy = {
  sectionLabels: {
    overview: '总览',
    appearance: '外观',
    behavior: '主动',
    model: '模型',
    cognition: '认知',
    advanced: '高级',
  },
  chrome: {
    title: '智能体中心',
    eyebrow: '智能体中心',
    closeLabel: '关闭智能体中心',
    navLabel: '智能体中心分区',
    textReadyLabel: '运行时文本对话已就绪',
    avatarFallback: '羽',
    projectionLoadFailed: '智能体中心投影加载失败。',
  },
  progress: {
    configLabel: '配置',
  },
  overview: {
    readyTitle: '本地伙伴已就绪',
    attentionTitle: '配置需要处理',
    checklistTitle: '配置检查',
    appearanceReadyDescription: '形象投影已由运行时确认。',
    appearancePendingDescription: '形象与外观还需要完成配置。',
    modelReadyDescription: '运行时文本与记忆路线已就绪。',
    modelPendingDescription: '文本和记忆路线需要在运行时完成配置。',
    behaviorReadyDescriptionPrefix: '主动陪伴已开启。',
    behaviorReadyEnabledFallback: '已开启',
    behaviorOffDescription: '主动陪伴尚未开启，可在运行时配置中启用。',
    cognitionFallbackDescription: '认知、情绪与记忆摘要由运行时投影。',
    readyPill: '就绪',
    needsSetupPill: '待配置',
    enabledPill: '已开启',
    offPill: '关闭',
    projectedPill: '已投影',
    readOnlyPill: '只读',
  },
  advanced: {
    title: '高级',
    descriptionRuntimeProjection: '运行时投影',
    descriptionUnavailable: '暂不可用',
    configRevisionLabel: '配置版本',
    runtimeTurnLabel: '运行时回合',
    runtimeStreamLabel: '运行时流',
    runtimeErrorLabel: '运行时错误',
    unavailableValue: '暂不可用',
    notProjectedValue: '尚未投影',
    noneValue: '无',
  },
  model: {
    sectionTitle: '模型',
    superSectionLabels: {
      conversation: '对话',
      voice: '语音',
      media: '媒体',
    },
    detailActiveModelHint: '点击更换模型',
    setupRequiredLabel: '需要配置',
    runtimeModelPickerUnavailableLabel: '运行时模型选择暂不可用',
    notConfiguredLabel: '未配置',
    profileImportUnsupportedLabel: '当前界面尚未准入运行时智能体配置导入。',
    profileImportUnavailableLabel: '当前界面暂不支持配置导入。',
    profilePreviewUnsupportedLabel: '应用前请先在运行时完成配置预览准入。',
    profileFirstApplyLabel: '这是此界面的首次配置应用。',
    parameterEditRejected: '当前界面不允许编辑应用侧模型参数。',
    profileSliceRefRejected: '运行时智能体配置不接受配置片段模型引用。',
    adapterUnavailable: '运行时智能体配置适配器暂不可用。',
    revisionUnavailable: '运行时智能体配置版本暂不可用。',
    savingStatus: '正在保存模型选择。',
    savedStatusFormat: '已保存运行时智能体配置版本 {{revision}}。',
    updateFailed: '运行时智能体配置更新失败。',
    projectionReadyBadge: '就绪',
    projectionReadyTitle: '运行时已就绪',
    projectionNeedsSetupBadge: '待配置',
    projectionRouteNotConfiguredTitle: '运行时路线尚未配置',
    projectionModelRequiredTitle: '需要选择模型',
    projectionUnavailableTitle: '运行时投影暂不可用',
    modelSelectionUnresolvedSuffix: '模型选择没有解析出运行时模型 ID。',
    modelConfig: {
      'ModelConfig.hub.title': '智能模型',
      'ModelConfig.hub.aggregateReady': '运行时就绪',
      'ModelConfig.hub.aggregateAttention': '需要配置',
      'ModelConfig.hub.aggregateNeutral': '未配置',
      'ModelConfig.hub.aggregateEmpty': '尚未配置模型路线',
      'ModelConfig.hub.backLabel': '返回',
      'ModelConfig.hub.detailStatusReady': '运行时就绪',
      'ModelConfig.hub.detailStatusAttention': '需要配置',
      'ModelConfig.hub.detailStatusNeutral': '未配置',
      'ModelConfig.hub.detailTitleFormat': '{{section}}配置',
      'ModelConfig.hub.activeModelLabel': '当前模型',
      'ModelConfig.hub.activeModelHint': '点击更换模型',
      'ModelConfig.hub.activeModelConfiguredLabel': '已配置',
      'ModelConfig.hub.activeModelSetupPendingLabel': '待配置',
      'ModelConfig.profile.sectionTitle': '智能配置档',
      'ModelConfig.profile.summaryLabel': '智能配置档',
      'ModelConfig.profile.emptySummaryLabel': '尚未应用配置档',
      'ModelConfig.profile.applyButtonLabel': '应用',
      'ModelConfig.profile.changeButtonLabel': '更换',
      'ModelConfig.profile.manageButtonTitle': '管理配置档',
      'ModelConfig.profile.modalTitle': '导入智能配置档',
      'ModelConfig.profile.modalHint': '当前界面尚未准入运行时智能体配置导入。',
      'ModelConfig.profile.loadingLabel': '正在加载配置档...',
      'ModelConfig.profile.emptyLabel': '当前界面暂不支持配置档导入。',
      'ModelConfig.profile.currentBadgeLabel': '当前',
      'ModelConfig.profile.cancelLabel': '取消',
      'ModelConfig.profile.confirmLabel': '确认',
      'ModelConfig.profile.applyingLabel': '应用中...',
      'ModelConfig.profile.reloadLabel': '重新加载',
      'ModelConfig.profile.importLabel': '导入智能配置档',
      'ModelConfig.profile.previewTitle': '预览配置档',
      'ModelConfig.profile.previewHint': '应用前先复核运行时智能体配置变化。',
      'ModelConfig.profile.previewingLabel': '预览中...',
      'ModelConfig.profile.previewFirstApplyLabel': '这是此界面的首次配置应用。',
      'ModelConfig.profile.previewNoChangeLabel': '没有变化。',
      'ModelConfig.profile.previewBeforeLabel': '应用前',
      'ModelConfig.profile.previewAfterLabel': '应用后',
      'ModelConfig.profile.previewWarningsLabel': '提醒',
      'ModelConfig.profile.previewConfirmLabel': '应用配置档',
      'ModelConfig.profile.previewBackLabel': '返回',
      'ModelConfig.section.chat.title': '对话',
      'ModelConfig.section.tts.title': '语音',
      'ModelConfig.section.image.title': '图像',
      'ModelConfig.section.voice.title': '声音工作流',
      'ModelConfig.section.embed.title': '记忆',
      'ModelConfig.capability.textGenerate.title': '文本生成',
      'ModelConfig.capability.textGenerate.subtitle': '本地伙伴对话与生命周期',
      'ModelConfig.capability.textGenerate.detail': '已提交的 text.generate 意图。',
      'ModelConfig.capability.textEmbed.title': '记忆嵌入',
      'ModelConfig.capability.textEmbed.subtitle': '记忆、认知与活动检索',
      'ModelConfig.capability.textEmbed.detail': '已提交的 text.embed 意图。',
      'ModelConfig.capability.audioSynthesize.title': '语音合成',
      'ModelConfig.capability.audioSynthesize.subtitle': '运行时托管的语音输出路线',
      'ModelConfig.capability.audioSynthesize.detail': '已提交的 audio.synthesize 意图。',
      'ModelConfig.capability.voiceWorkflowVoiceClone.title': '声音克隆',
      'ModelConfig.capability.voiceWorkflowVoiceClone.subtitle': '运行时声音工作流路线',
      'ModelConfig.capability.voiceWorkflowVoiceClone.detail': '已提交的声音克隆意图。',
      'ModelConfig.capability.voiceWorkflowVoiceDesign.title': '声音设计',
      'ModelConfig.capability.voiceWorkflowVoiceDesign.subtitle': '运行时声音工作流路线',
      'ModelConfig.capability.voiceWorkflowVoiceDesign.detail': '已提交的声音设计意图。',
      'ModelConfig.capability.imageGenerate.title': '图像生成',
      'ModelConfig.capability.imageGenerate.subtitle': '运行时图像动作路线',
      'ModelConfig.capability.imageGenerate.detail': '已提交的 image.generate 意图。',
    },
  },
};

export function RightAgentPanel(props: RightAgentPanelProps) {
  const agentCenterWorld = agentCenterWorldLabel(props.evidence);
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
  const autonomyMutationAvailable = Boolean(
    props.evidence.conversation.ready
      && props.evidence.conversation.conversationAnchorId,
  );
  const autonomyDisabledReason = autonomyMutationAvailable ? null : chatBlockedHint(props.evidence);
  const state = useMemo<AgentCenterStateInput>(() => ({
    runtimeError: props.evidence.runtime.ready ? null : `${props.evidence.runtime.reasonCode}: ${props.evidence.runtime.message}`,
    autonomyMutationAvailable,
    autonomyDisabledReason,
  }), [
    autonomyDisabledReason,
    autonomyMutationAvailable,
    props.evidence.runtime.message,
    props.evidence.runtime.ready,
    props.evidence.runtime.reasonCode,
  ]);

  return (
    <aside
      className="zhiyu-agent-center mr-2 my-12 flex h-[calc(100cqh-96px)] min-h-0 w-[min(500px,calc(100cqw-96px))] max-w-full shrink-0 [grid-area:side] max-[980px]:my-0 max-[980px]:mr-0 max-[980px]:h-auto max-[980px]:min-h-[min(640px,calc(100cqh-20px))] max-[980px]:w-full"
      data-zhiyu-region="agent-panel"
      data-zhiyu-agent-center-placement="kit"
      data-zhiyu-agent-panel-mode={props.mode}
      data-zhiyu-agent-center-side-sheet="desktop"
      aria-label="智能体中心区域"
    >
      <AppCardSurface
        kind="promoted-glass"
        as="section"
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div
          className="zhiyu-agent-center__header flex items-start gap-2 border-b border-white/70 px-4 py-1"
          data-zhiyu-agent-center-header="true"
          data-zhiyu-agent-center-owner="kit-placement"
        >
          <div className="zhiyu-agent-center__identity flex min-w-0 flex-1 flex-col gap-1">
            <div className="zhiyu-agent-center__chrome-row flex min-w-0 items-center gap-2">
              <span className="block shrink-0 text-[12px] font-semibold text-[var(--nimi-text-muted)]" data-zhiyu-agent-center-eyebrow="agent-center">智能体中心</span>
              <span
                className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-white/70 px-2.5 text-[12px] font-semibold text-[var(--nimi-text-secondary)] shadow-[inset_0_0_0_1px_rgba(148,163,184,0.24)]"
                data-zhiyu-agent-center-runtime-pill={runtimeState}
                title={props.evidence.runtime.ready ? '运行时已就绪' : props.evidence.runtime.message}
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${runtimeDotClass}`}
                  data-zhiyu-agent-center-runtime-dot={runtimeState}
                />
                <span>运行时</span>
              </span>
            </div>
            <div className="zhiyu-agent-center__profile-row flex min-w-0 items-center gap-3">
              <span className="zhiyu-agent-center__avatar grid h-[52px] w-[52px] shrink-0 place-items-center rounded-[16px] border border-emerald-300/70 bg-emerald-500/20 text-[18px] font-semibold text-emerald-900 shadow-[0_0_0_3px_rgba(168,85,247,0.22)]" aria-hidden="true">
                {partnerInitial(props.currentPartnerName)}
              </span>
              <div className="zhiyu-agent-center__title min-w-0 flex-1">
                <div className="flex min-w-0 items-center">
                  <strong className="m-0 block min-w-0 truncate text-[15px] font-semibold tracking-tight text-[var(--nimi-text-primary)]">{props.currentPartnerName}</strong>
                </div>
                <div className="zhiyu-agent-center__meta mt-1 flex min-w-0 flex-nowrap items-center gap-x-1 overflow-hidden">
                  {moodLabel ? (
                    <span
                      className="inline-flex max-w-[76px] shrink-0 items-center truncate rounded-full bg-violet-500/10 px-1.5 py-px text-[10px] font-semibold text-violet-700"
                      data-zhiyu-agent-center-state-chip="mood"
                      title={`情绪：${moodLabel}`}
                    >
                      {moodLabel}
                    </span>
                  ) : null}
                  {activityLabel ? (
                    <span
                      className="inline-flex max-w-[76px] shrink-0 items-center truncate rounded-full bg-sky-500/10 px-1.5 py-px text-[10px] font-semibold text-sky-700"
                      data-zhiyu-agent-center-state-chip="activity"
                      title={`活动：${activityLabel}`}
                    >
                      {activityLabel}
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
            </div>
          </div>
          <IconToggleAction
            type="button"
            aria-label="关闭智能体中心"
            title="关闭面板"
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
            ariaLabel="织羽智能体中心"
            activeSection={props.activeTab}
            copy={ZHIYU_AGENT_CENTER_COPY}
            appearanceCopy={ZHIYU_AGENT_CENTER_APPEARANCE_COPY}
            behaviorCopy={ZHIYU_AGENT_CENTER_BEHAVIOR_COPY}
            chrome="embedded"
            onSectionChange={props.onActiveTabChange}
            placementActions={{
              close: props.onClose,
              openRuntimeSettings: props.onOpenDesktopAgentConfig,
              launchAvatar: props.onAvatarLaunch,
            }}
            appearanceAdapter={props.appearanceAdapter}
            runtimeAdapter={props.runtimeAdapter}
            state={state}
          />
        </div>
      </AppCardSurface>
    </aside>
  );
}
