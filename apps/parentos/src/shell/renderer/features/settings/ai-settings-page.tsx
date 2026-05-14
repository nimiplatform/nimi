import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  ModelConfigAiModelHub,
  defaultModelConfigProfileCopy,
  useModelConfigProfileController,
  type AppModelConfigSurface,
} from '@nimiplatform/nimi-kit/features/model-config';
import { Surface, buttonVariants, cn } from '@nimiplatform/nimi-kit/ui';
import { applyAIProfileToConfig, type AIConfig } from '@nimiplatform/sdk/mod';
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
      className={bannerCopy.kind === 'warning'
        ? 'mt-4 parentos-radius-md border border-[color-mix(in_srgb,var(--nimi-status-warning)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))] px-4 py-3 text-sm text-[var(--nimi-status-warning)]'
        : 'mt-4 parentos-radius-md border border-[color-mix(in_srgb,var(--nimi-status-danger)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,var(--nimi-surface-card))] px-4 py-3 text-sm text-[var(--nimi-status-danger)]'}
    >
      {bannerCopy.message}
    </div>
  ) : null;

  return (
    <div className="h-full overflow-y-auto bg-transparent">
      <div className="mx-auto max-w-3xl px-6 pb-6 pt-[72px]">
        <div className="mb-6 flex items-center gap-3">
          <Link
            to="/settings"
            className={cn(buttonVariants({ tone: 'ghost', size: 'sm' }), 'h-8 min-h-8 w-8 px-0')}
            aria-label="返回设置"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--nimi-text-primary)]">AI 模型设置</h1>
        </div>

        <Surface tone="card" material="solid" elevation="base" padding="lg" className="parentos-radius-lg">
          <ModelConfigAiModelHub
            surface={surface}
            profile={profileController}
            footer={footer}
          />
        </Surface>
      </div>
    </div>
  );
}
