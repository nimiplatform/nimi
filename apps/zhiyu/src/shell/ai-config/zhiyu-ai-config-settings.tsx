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
  'ModelConfig.section.chat.title': '对话',
  'ModelConfig.section.chat.subtitle': '文本与流式对话',
  'ModelConfig.section.chat.detail': '用于织羽对话、文本生成和连续回复。',
  'ModelConfig.section.embed.title': '嵌入',
  'ModelConfig.section.embed.subtitle': '文本向量',
  'ModelConfig.section.embed.detail': '用于记忆召回和文本嵌入预览。',
  'ModelConfig.section.image.title': '图像',
  'ModelConfig.section.image.subtitle': '对话图像产物',
  'ModelConfig.section.image.detail': '用于伙伴对话中返回的图像产物。',
  'ModelConfig.section.audio.title': '语音',
  'ModelConfig.section.audio.subtitle': '语音合成',
  'ModelConfig.section.audio.detail': '用于伙伴语音与朗读产物。',
  'ModelConfig.capability.textGenerate.title': '文本生成',
  'ModelConfig.capability.textGenerate.subtitle': '文字模型',
  'ModelConfig.capability.textGenerate.detail': '织羽对话与连续回复共用此文字模型绑定。',
  'ModelConfig.capability.textEmbed.title': '文本嵌入',
  'ModelConfig.capability.textEmbed.subtitle': '嵌入模型',
  'ModelConfig.capability.textEmbed.detail': '为记忆与相似度召回选择嵌入模型。',
  'ModelConfig.capability.imageGenerate.title': '对话图像产物',
  'ModelConfig.capability.imageGenerate.subtitle': '图像模型',
  'ModelConfig.capability.imageGenerate.detail': '为伙伴对话中返回的图像产物选择上游模型。',
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
    sections: ['image'],
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
      className={variant === 'embedded' ? 'zhiyu-ai-config-embedded__model-hub' : 'zhiyu-ai-config-drawer__model-hub'}
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
    'chat.stream': { placeholder: '选择对话模型' },
    'text.embed': { placeholder: '选择嵌入模型' },
    'image.generate': { placeholder: '选择图像模型' },
  };
}

function capabilityTitle(capabilityId: string): string {
  if (capabilityId === 'text.generate') return '文本生成';
  if (capabilityId === 'chat.stream') return '连续回复';
  if (capabilityId === 'text.embed') return '文本嵌入';
  if (capabilityId === 'image.generate') return '对话图像产物';
  return capabilityId;
}
