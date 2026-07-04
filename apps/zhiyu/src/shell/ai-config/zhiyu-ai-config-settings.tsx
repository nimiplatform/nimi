import { useEffect, useMemo, useState } from 'react';
import { IconButton, ScrollArea, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import {
  ModelConfigAiModelHub,
  defaultModelConfigProfileCopy,
  resolveModelConfigLocalRuntimeStatus,
  useModelConfigProfileController,
  type AppModelConfigSurface,
  type ModelConfigProjectionStatus,
  type ModelConfigSuperSection,
  type SharedAIConfigService,
} from '@nimiplatform/kit/features/model-config';
import type { RouteModelPickerDataProvider } from '@nimiplatform/kit/features/model-picker';
import type {
  NimiAICapabilityRequirementDeclaration,
  NimiAIConfig,
  NimiAIScopeRef,
} from '@nimiplatform/kit/core/sdk-contract';
import type { CanonicalCapabilitySectionId } from '@nimiplatform/kit/core/runtime-capabilities';
import { X } from 'lucide-react';
import {
  ZHIYU_AI_CONFIG_BINDING_CAPABILITIES,
  ZHIYU_AI_CONFIG_ENABLED_CAPABILITIES,
  type ZhiyuAIConfigEnabledCapability,
} from './zhiyu-ai-config-capabilities';
import {
  createZhiyuModelConfigLocalAssetSource,
  listZhiyuRuntimeModelConfigLocalAssets,
  type ZhiyuModelConfigLocalAssetSourceState,
} from './zhiyu-runtime-model-provider';

export type ZhiyuAiConfigSettingsProps = {
  readonly scopeRef: NimiAIScopeRef;
  readonly service: SharedAIConfigService;
  readonly providerResolver: (capabilityId: string) => RouteModelPickerDataProvider | null;
  readonly runtimeReady: boolean;
  readonly runtimeDetail: string | null;
  readonly initialSection?: CanonicalCapabilitySectionId | null;
  readonly variant?: 'drawer' | 'embedded';
  readonly onClose?: () => void;
};

const MODEL_CONFIG_COPY: Record<string, string> = {
  'Zhiyu.aiConfig.title': '模型配置',
  'Zhiyu.aiConfig.subtitle': '选择织羽对话、嵌入和对话图像产物所需的模型',
  'Zhiyu.aiConfig.close': '关闭模型配置',
  'ModelConfig.hub.title': 'AI 模型',
  'ModelConfig.hub.aggregateReady': '{{count}} 已就绪',
  'ModelConfig.hub.aggregateAttention': '{{count}} 需要配置',
  'ModelConfig.hub.aggregateNeutral': '{{count}} 未设置',
  'ModelConfig.hub.aggregateEmpty': '未配置任何能力',
  'ModelConfig.hub.importProfileLabel': '导入 AI 预设',
  'ModelConfig.profile.importLabel': '导入 AI 预设',
  'ModelConfig.profile.summaryLabel': 'AI 预设',
  'ModelConfig.profile.emptySummaryLabel': '未选择预设',
  'ModelConfig.profile.sectionTitle': 'AI 预设',
  'ModelConfig.profile.applyButtonLabel': '应用',
  'ModelConfig.profile.changeButtonLabel': '更换',
  'ModelConfig.profile.manageButtonTitle': '管理 AI 预设',
  'ModelConfig.profile.modalTitle': '导入 AI 预设',
  'ModelConfig.profile.modalHint': '从账户预设库导入模型配置。',
  'ModelConfig.profile.loadingLabel': '正在加载',
  'ModelConfig.profile.emptyLabel': '暂无可导入的 AI 预设',
  'ModelConfig.profile.currentBadgeLabel': '当前',
  'ModelConfig.profile.cancelLabel': '取消',
  'ModelConfig.profile.confirmLabel': '预览',
  'ModelConfig.profile.applyingLabel': '正在应用',
  'ModelConfig.profile.reloadLabel': '刷新',
  'ModelConfig.profile.previewTitle': '预览 AI 预设',
  'ModelConfig.profile.previewHint': '确认预设将如何覆盖当前模型配置。',
  'ModelConfig.profile.previewingLabel': '正在预览',
  'ModelConfig.profile.previewFirstApplyLabel': '这是第一次应用该预设。',
  'ModelConfig.profile.previewNoChangeLabel': '当前配置与该预设一致。',
  'ModelConfig.profile.previewBeforeLabel': '当前',
  'ModelConfig.profile.previewAfterLabel': '预设',
  'ModelConfig.profile.previewWarningsLabel': '注意',
  'ModelConfig.profile.previewConfirmLabel': '应用预设',
  'ModelConfig.profile.previewBackLabel': '返回',
  'ModelConfig.section.chat.title': '对话',
  'ModelConfig.section.chat.subtitle': '文本与流式对话',
  'ModelConfig.section.chat.detail': '用于织羽对话、文本生成和连续回复。',
  'ModelConfig.section.embed.title': '嵌入',
  'ModelConfig.section.embed.subtitle': '文本向量',
  'ModelConfig.section.embed.detail': '用于记忆召回和文本嵌入预览。',
  'ModelConfig.section.tts.title': '文本转语音',
  'ModelConfig.section.tts.subtitle': '语音合成与声音工作流',
  'ModelConfig.section.tts.detail': '用于伙伴语音、朗读和声音生成工作流。',
  'ModelConfig.section.stt.title': '语音转文本',
  'ModelConfig.section.stt.subtitle': '语音识别',
  'ModelConfig.section.stt.detail': '用于把用户语音转换为文本输入。',
  'ModelConfig.section.image.title': '图像',
  'ModelConfig.section.image.subtitle': '对话图像产物',
  'ModelConfig.section.image.detail': '用于伙伴对话中返回的图像产物。',
  'ModelConfig.section.video.title': '视频',
  'ModelConfig.section.video.subtitle': '视频生成',
  'ModelConfig.section.video.detail': '用于伙伴对话中返回的视频产物。',
  'ModelConfig.section.voice.title': '声音',
  'ModelConfig.section.voice.subtitle': '声音工作流',
  'ModelConfig.section.voice.detail': '用于声音克隆、声音设计等工作流。',
  'ModelConfig.section.world.title': '世界',
  'ModelConfig.section.world.subtitle': '世界生成',
  'ModelConfig.section.world.detail': '用于世界与叙事上下文生成。',
  'ModelConfig.section.audio.title': '语音',
  'ModelConfig.section.audio.subtitle': '语音合成',
  'ModelConfig.section.audio.detail': '用于伙伴语音与朗读产物。',
  'ModelConfig.capability.textGenerate.title': '文本生成',
  'ModelConfig.capability.textGenerate.subtitle': '文字模型',
  'ModelConfig.capability.textGenerate.detail': '织羽对话与连续回复共用此文字模型绑定。',
  'ModelConfig.capability.audioSynthesize.title': '文本转语音',
  'ModelConfig.capability.audioSynthesize.subtitle': '语音合成模型',
  'ModelConfig.capability.audioSynthesize.detail': '为伙伴朗读和语音回复选择语音合成模型。',
  'ModelConfig.capability.audioTranscribe.title': '语音转文本',
  'ModelConfig.capability.audioTranscribe.subtitle': '语音识别模型',
  'ModelConfig.capability.audioTranscribe.detail': '为语音输入选择转写模型。',
  'ModelConfig.capability.voiceWorkflowVoiceClone.title': '声音克隆',
  'ModelConfig.capability.voiceWorkflowVoiceClone.subtitle': '声音工作流',
  'ModelConfig.capability.voiceWorkflowVoiceClone.detail': '为声音克隆工作流选择模型或服务。',
  'ModelConfig.capability.voiceWorkflowVoiceDesign.title': '声音设计',
  'ModelConfig.capability.voiceWorkflowVoiceDesign.subtitle': '声音工作流',
  'ModelConfig.capability.voiceWorkflowVoiceDesign.detail': '为声音设计工作流选择模型或服务。',
  'ModelConfig.capability.textEmbed.title': '文本嵌入',
  'ModelConfig.capability.textEmbed.subtitle': '嵌入模型',
  'ModelConfig.capability.textEmbed.detail': '为记忆与相似度召回选择嵌入模型。',
  'ModelConfig.capability.imageGenerate.title': '对话图像产物',
  'ModelConfig.capability.imageGenerate.subtitle': '图像模型',
  'ModelConfig.capability.imageGenerate.detail': '为伙伴对话中返回的图像产物选择上游模型。',
  'ModelConfig.capability.imageEdit.title': '图像编辑',
  'ModelConfig.capability.imageEdit.subtitle': '图像模型',
  'ModelConfig.capability.imageEdit.detail': '为图像编辑和二次生成选择模型。',
  'ModelConfig.capability.videoGenerate.title': '视频生成',
  'ModelConfig.capability.videoGenerate.subtitle': '视频模型',
  'ModelConfig.capability.videoGenerate.detail': '为伙伴对话中返回的视频产物选择模型。',
  'ModelConfig.hub.detailTitleFormat': '{{section}} 配置',
  'ModelConfig.hub.backLabel': '返回模型配置',
  'ModelConfig.hub.activeModelLabel': '当前模型',
  'ModelConfig.hub.activeModelHint': '点击更换模型',
  'ModelConfig.hub.activeModelConfiguredLabel': '已绑定',
  'ModelConfig.hub.activeModelSetupPendingLabel': '待完成设置',
  'ModelConfig.hub.detailStatusReady': '已绑定',
  'ModelConfig.hub.detailStatusAttention': '需要设置',
  'ModelConfig.hub.detailStatusNeutral': '未配置',
  'ModelConfig.editor.textGenerate.parametersLabel': '参数',
  'ModelConfig.editor.common.previewBadgeLabel': '预览',
  'ModelConfig.editor.textGenerate.promptControlsLabel': '提示词控制',
  'ModelConfig.editor.textGenerate.toneLabel': '语气',
  'ModelConfig.editor.textGenerate.lengthLabel': '长度',
  'ModelConfig.editor.textGenerate.generationDefaultsLabel': '生成默认值',
  'ModelConfig.editor.textGenerate.responseControlsLabel': '回复控制',
  'ModelConfig.editor.textGenerate.advancedLabel': '高级设置',
  'ModelConfig.editor.textGenerate.temperatureLabel': '温度',
  'ModelConfig.editor.textGenerate.topPLabel': 'Top P',
  'ModelConfig.editor.textGenerate.topKLabel': 'Top K',
  'ModelConfig.editor.textGenerate.maxTokensLabel': '最大 token',
  'ModelConfig.editor.textGenerate.presencePenaltyLabel': '存在惩罚',
  'ModelConfig.editor.textGenerate.frequencyPenaltyLabel': '频率惩罚',
  'ModelConfig.editor.textGenerate.stopSequencesLabel': '停止序列',
  'ModelConfig.editor.textGenerate.stopSequencesHint': '最多 {{max}} 个停止序列，每行一个。',
  'ModelConfig.editor.textGenerate.stopSequencesPlaceholder': '输入后按 Enter',
  'ModelConfig.editor.textGenerate.tone.clear': '清晰',
  'ModelConfig.editor.textGenerate.tone.warm': '温和',
  'ModelConfig.editor.textGenerate.tone.formal': '正式',
  'ModelConfig.editor.textGenerate.tone.short': '简短',
  'ModelConfig.editor.textGenerate.length.short': '短',
  'ModelConfig.editor.textGenerate.length.medium': '中等',
  'ModelConfig.editor.textGenerate.length.detailed': '详细',
  'ModelConfig.editor.textGenerate.timeoutLabel': 'Timeout',
  'ModelConfig.editor.common.defaultPlaceholder': '默认',
  'ModelConfig.editor.common.randomPlaceholder': '随机',
  'ModelConfig.editor.common.requiredLabel': '必需',
  'ModelConfig.editor.common.requiredSetupPlaceholder': '需要设置',
  'ModelConfig.editor.common.setupPendingLabel': '待设置',
  'ModelConfig.editor.common.seedLabel': 'Seed',
  'ModelConfig.editor.common.seedHint': '留空则由运行服务决定。',
  'ModelConfig.editor.common.timeoutLabel': '超时',
  'ModelConfig.editor.common.noneLabel': '无',
  'ModelConfig.editor.image.modelFamilyLabel': '模型家族',
  'ModelConfig.editor.image.companionModelsLabel': '伴随模型',
  'ModelConfig.editor.image.parametersLabel': '图像参数',
  'ModelConfig.editor.image.sizeLabel': '尺寸',
  'ModelConfig.editor.image.responseFormatLabel': '输出格式',
  'ModelConfig.editor.image.stepsLabel': '步数',
  'ModelConfig.editor.image.cfgScaleLabel': 'CFG scale',
  'ModelConfig.editor.image.samplerLabel': 'Sampler',
  'ModelConfig.editor.image.schedulerLabel': 'Scheduler',
  'ModelConfig.editor.image.customOptionsLabel': '自定义选项',
  'ModelConfig.editor.image.customOptionsHint': '每行一个运行参数。',
  'ModelConfig.editor.image.oneOptionPerLinePlaceholder': '每行一个选项',
};

const ZHIYU_MODEL_CONFIG_SUPER_SECTIONS: readonly ModelConfigSuperSection[] = [
  {
    id: 'conversation',
    label: '对话',
    sections: ['chat', 'embed'],
  },
  {
    id: 'voice',
    label: '语音',
    sections: ['tts', 'stt', 'voice'],
  },
  {
    id: 'media',
    label: '媒体',
    sections: ['image', 'video'],
  },
  {
    id: 'world',
    label: '世界',
    sections: ['world'],
  },
];

function makeTranslator(copy: Record<string, string>) {
  return (key: string, vars?: Readonly<Record<string, string | number>>): string => {
    const value = copy[key] || (typeof vars?.defaultValue === 'string' ? vars.defaultValue : humanizeModelConfigKey(key));
    if (!vars) {
      return value;
    }
    return Object.entries(vars).reduce(
      (current, [name, replacement]) => current.replaceAll(`{{${name}}}`, String(replacement)),
      value,
    );
  };
}

function humanizeModelConfigKey(key: string): string {
  const last = key.split('.').pop() || key;
  return last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/Label$/, '').trim() || key;
}

function useLiveAIConfig(service: SharedAIConfigService, scopeRef: NimiAIScopeRef): NimiAIConfig {
  const [config, setConfig] = useState<NimiAIConfig>(() => service.aiConfig.get(scopeRef));
  useEffect(() => {
    setConfig(service.aiConfig.get(scopeRef));
    return service.aiConfig.subscribe(scopeRef, setConfig);
  }, [service, scopeRef]);
  return config;
}

function createRequirementDeclaration(scopeRef: NimiAIScopeRef): NimiAICapabilityRequirementDeclaration {
  return {
    requirementId: `${scopeRef.ownerId}:${scopeRef.surfaceId || 'default'}:zhiyu-agent-home`,
    scopeRef,
    requiredSlices: ZHIYU_AI_CONFIG_ENABLED_CAPABILITIES.map((capability) => ({
      requirementSliceId: `zhiyu-agent-home.${capability}`,
      capability,
      profileSliceRef: `profile.${ZHIYU_AI_CONFIG_BINDING_CAPABILITIES[capability]}`,
      readinessPolicy: 'required' as const,
    })),
    setupProjectionPolicy: 'sdk-ai-config-setup-projection',
  };
}

function bindingCapability(capabilityId: string): string {
  return ZHIYU_AI_CONFIG_BINDING_CAPABILITIES[capabilityId as ZhiyuAIConfigEnabledCapability] || capabilityId;
}

function bindingStatus(
  config: NimiAIConfig,
  capabilityId: string,
  runtimeReady: boolean,
  runtimeDetail: string | null,
  localAssetSource?: AppModelConfigSurface['localAssetSource'],
): ModelConfigProjectionStatus {
  if (!runtimeReady) {
    return {
      supported: false,
      tone: 'attention',
      badgeLabel: '本地服务不可用',
      title: '本地服务不可用',
      detail: runtimeDetail || '等待本地运行服务。',
    };
  }
  const bindingCapabilityId = bindingCapability(capabilityId);
  const targetRef = config.capabilities.targetRefs[bindingCapabilityId] || null;
  if (!targetRef) {
    return {
      supported: false,
      tone: 'attention',
      badgeLabel: '需要模型',
      title: '需要模型目标',
      detail: `运行 ${capabilityTitle(capabilityId)} 前必须先绑定模型目标。`,
    };
  }
  const localRuntimeSetup = localAssetSource && !localAssetSource.loading
    ? resolveModelConfigLocalRuntimeStatus({
      capabilityId: bindingCapabilityId,
      config,
      targetRef,
      assets: localAssetSource.list(),
    })
    : null;
  if (localRuntimeSetup) {
    return localRuntimeSetup;
  }
  return {
    supported: true,
    tone: 'ready',
    badgeLabel: '已绑定',
    title: '模型目标已绑定',
    detail: null,
  };
}

export function ZhiyuAiConfigSettings({
  scopeRef,
  service,
  providerResolver,
  runtimeReady,
  runtimeDetail,
  initialSection = null,
  variant = 'drawer',
  onClose,
}: ZhiyuAiConfigSettingsProps) {
  const t = useMemo(() => makeTranslator(MODEL_CONFIG_COPY), []);
  const config = useLiveAIConfig(service, scopeRef);
  const [localAssetState, setLocalAssetState] = useState<ZhiyuModelConfigLocalAssetSourceState>({
    loading: false,
    assets: [],
  });
  const requirementDeclaration = useMemo(() => createRequirementDeclaration(scopeRef), [scopeRef]);
  useEffect(() => {
    let active = true;
    if (!runtimeReady) {
      setLocalAssetState({ loading: false, assets: [] });
      return () => {
        active = false;
      };
    }
    setLocalAssetState((current) => ({
      loading: true,
      assets: current.assets,
    }));
    void listZhiyuRuntimeModelConfigLocalAssets()
      .then((assets) => {
        if (active) {
          setLocalAssetState({ loading: false, assets });
        }
      })
      .catch(() => {
        if (active) {
          setLocalAssetState({ loading: false, assets: [] });
        }
      });
    return () => {
      active = false;
    };
  }, [runtimeReady]);
  const localAssetSource = useMemo(
    () => createZhiyuModelConfigLocalAssetSource(localAssetState),
    [localAssetState],
  );
  const surface: AppModelConfigSurface = useMemo(() => ({
    scopeRef,
    aiConfigService: service,
    requirementDeclaration,
    providerResolver: (capabilityId: string) => (runtimeReady ? providerResolver(capabilityId) : null),
    projectionResolver: (capabilityId: string) => bindingStatus(config, capabilityId, runtimeReady, runtimeDetail, localAssetSource),
    localAssetSource,
    runtimeNotReadyLabel: runtimeDetail || '本地服务不可用',
    capabilityOverrides: createZhiyuCapabilityOverrides(),
    i18n: { t },
  }), [config, localAssetSource, providerResolver, requirementDeclaration, runtimeDetail, runtimeReady, scopeRef, service, t]);
  const profileCopy = useMemo(() => defaultModelConfigProfileCopy(t), [t]);
  const currentOrigin = useMemo(
    () => (config.profileOrigin
      ? { profileId: config.profileOrigin.profileId, title: config.profileOrigin.title }
      : null),
    [config.profileOrigin],
  );
  const profileController = useModelConfigProfileController({
    scopeRef,
    aiConfigService: service,
    requirementDeclaration,
    copy: profileCopy,
    currentOrigin,
  });

  const modelHub = (
    <ModelConfigAiModelHub
      surface={surface}
      profile={profileController}
      initialSection={initialSection}
      detailActiveModelHint={null}
      className={variant === 'embedded' ? 'zhiyu-ai-config-embedded__model-hub space-y-5' : 'zhiyu-ai-config-drawer__model-hub space-y-5'}
      superSections={ZHIYU_MODEL_CONFIG_SUPER_SECTIONS}
    />
  );

  if (variant === 'embedded') {
    return (
      <div
        className="zhiyu-ai-config-embedded"
        data-zhiyu-ai-config-embedded="agent-center"
        data-zhiyu-ai-config-drawer="embedded"
      >
        {modelHub}
      </div>
    );
  }

  return (
    <div className="zhiyu-ai-config-drawer" role="dialog" aria-modal="true" aria-label={t('Zhiyu.aiConfig.title')}>
      <Surface
        as="section"
        tone="panel"
        material="glass-regular"
        elevation="floating"
        padding="none"
        className="zhiyu-ai-config-drawer__panel"
        data-zhiyu-ai-config-drawer="open"
        data-zhiyu-ai-config-drawer-panel="kit-glass"
      >
        <header className="zhiyu-ai-config-drawer__header">
          <div className="zhiyu-ai-config-drawer__title">
            <strong>{t('Zhiyu.aiConfig.title')}</strong>
            <span>{t('Zhiyu.aiConfig.subtitle')}</span>
          </div>
          {!runtimeReady ? (
            <StatusBadge tone="warning" shape="dot">本地服务不可用</StatusBadge>
          ) : null}
          {onClose ? (
            <IconButton
              aria-label={t('Zhiyu.aiConfig.close')}
              tone="ghost"
              size="sm"
              icon={<X size={16} />}
              onClick={onClose}
            />
          ) : null}
        </header>
        <ScrollArea className="zhiyu-ai-config-drawer__scroll">
          <div className="zhiyu-ai-config-drawer__body">
            {modelHub}
          </div>
        </ScrollArea>
      </Surface>
    </div>
  );
}

function createZhiyuCapabilityOverrides(): AppModelConfigSurface['capabilityOverrides'] {
  return {
    'text.generate': { placeholder: '选择文字模型' },
    'audio.synthesize': { placeholder: '选择语音合成模型' },
    'audio.transcribe': { placeholder: '选择语音识别模型' },
    'voice_workflow.voice_clone': { placeholder: '选择声音克隆工作流' },
    'voice_workflow.voice_design': { placeholder: '选择声音设计工作流' },
    'text.embed': { placeholder: '选择嵌入模型' },
    'image.generate': { placeholder: '选择图像模型' },
    'image.edit': { placeholder: '选择图像编辑模型' },
    'video.generate': { placeholder: '选择视频模型' },
  };
}

function capabilityTitle(capabilityId: string): string {
  if (capabilityId === 'text.generate') return '文本生成';
  if (capabilityId === 'audio.synthesize') return '文本转语音';
  if (capabilityId === 'audio.transcribe') return '语音转文本';
  if (capabilityId === 'voice_workflow.voice_clone') return '声音克隆';
  if (capabilityId === 'voice_workflow.voice_design') return '声音设计';
  if (capabilityId === 'text.embed') return '文本嵌入';
  if (capabilityId === 'image.generate') return '对话图像产物';
  if (capabilityId === 'image.edit') return '图像编辑';
  if (capabilityId === 'video.generate') return '视频生成';
  return capabilityId;
}
