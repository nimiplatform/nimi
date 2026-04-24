import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  ModelConfigAiModelHub,
  defaultModelConfigProfileCopy,
  useModelConfigProfileController,
  type AppModelConfigSurface,
} from '@nimiplatform/nimi-kit/features/model-config';
import { applyAIProfileToConfig, type AIConfig } from '@nimiplatform/sdk/mod';
import { S } from '../../app-shell/page-style.js';
import { PARENTOS_AI_SCOPE_REF } from './parentos-ai-config.js';
import { getParentosAIConfigService } from './parentos-ai-config-service.js';
import { getParentosRouteModelPickerProvider } from './parentos-route-model-picker-provider.js';
import {
  parentosAISettingsAvailabilityBannerCopy,
  parentosAISettingsAvailabilityLabel,
  probeParentosAISettingsAvailability,
  type ParentosAISettingsAvailability,
} from './parentos-ai-settings-availability.js';

const PARENTOS_ENABLED_CAPABILITIES = [
  'text.generate',
  'text.generate.vision',
  'audio.transcribe',
] as const;

export default function AiSettingsPage() {
  const { t } = useTranslation();
  const aiConfigService = useMemo(() => getParentosAIConfigService(), []);
  const [availability, setAvailability] = useState<ParentosAISettingsAvailability | null>(null);
  const [aiConfig, setAIConfig] = useState<AIConfig>(() => (
    aiConfigService.aiConfig.get(PARENTOS_AI_SCOPE_REF)
  ));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const nextAvailability = await probeParentosAISettingsAvailability();
      if (!cancelled) {
        setAvailability(nextAvailability);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setAIConfig(aiConfigService.aiConfig.get(PARENTOS_AI_SCOPE_REF));
    return aiConfigService.aiConfig.subscribe(PARENTOS_AI_SCOPE_REF, setAIConfig);
  }, [aiConfigService]);

  const runtimeReady = availability?.kind === 'ready';
  const runtimeStatusLabel = parentosAISettingsAvailabilityLabel(availability);
  const bannerCopy = parentosAISettingsAvailabilityBannerCopy(availability);

  const surface: AppModelConfigSurface = useMemo(() => ({
    scopeRef: PARENTOS_AI_SCOPE_REF,
    aiConfigService,
    enabledCapabilities: PARENTOS_ENABLED_CAPABILITIES,
    providerResolver: (routeCapability: string) => (
      runtimeReady ? getParentosRouteModelPickerProvider(routeCapability) : null
    ),
    projectionResolver: () => null,
    runtimeReady,
    runtimeNotReadyLabel: runtimeStatusLabel,
    i18n: { t },
  }), [aiConfigService, runtimeReady, runtimeStatusLabel, t]);

  const currentOrigin = useMemo(() => {
    const origin = aiConfig.profileOrigin;
    return origin ? { profileId: origin.profileId, title: origin.title } : null;
  }, [aiConfig.profileOrigin]);

  const profileController = useModelConfigProfileController({
    scopeRef: PARENTOS_AI_SCOPE_REF,
    aiConfigService,
    copy: defaultModelConfigProfileCopy(t),
    currentOrigin,
    applyAIProfileToConfig,
  });

  const footer = bannerCopy ? (
    <div
      className="mt-4 rounded-md px-4 py-3 text-sm"
      style={bannerCopy.kind === 'warning'
        ? { background: '#fef9e7', color: '#92400e', border: '1px solid #fde68a' }
        : { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}
    >
      {bannerCopy.message}
    </div>
  ) : null;

  return (
    <div className="h-full overflow-y-auto" style={{ background: 'transparent' }}>
      <div className={S.container} style={{ paddingTop: S.topPad }}>
        <div className="mb-6 flex items-center gap-3">
          <Link
            to="/settings"
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-black/5"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={S.text} strokeWidth="2" strokeLinecap="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: S.text }}>AI 模型设置</h1>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <ModelConfigAiModelHub
            surface={surface}
            profile={profileController}
            footer={footer}
          />
        </div>
      </div>
    </div>
  );
}
