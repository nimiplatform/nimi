import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AIConfig } from '@nimiplatform/sdk/mod';
import {
  ModelConfigAiModelHub,
  defaultModelConfigProfileCopy,
  useModelConfigProfileController,
  type AppModelConfigSurface,
} from '@nimiplatform/nimi-kit/features/model-config';
import { ScrollArea, cn } from '@nimiplatform/nimi-kit/ui';
import { applyAIProfileToConfig } from '@nimiplatform/sdk/mod';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { DesktopIconToggleAction } from '@renderer/components/action';
import { DesktopCardSurface } from '@renderer/components/surface';
import { getDesktopAIConfigService } from '@renderer/app-shell/providers/desktop-ai-config-service';
import { dispatchRuntimeConfigOpenPage } from '../runtime-config/runtime-config-navigation-events';
import { loadUserProfiles } from '../runtime-config/runtime-config-profile-storage';
import { getDesktopRouteModelPickerProvider } from '../runtime-config/desktop-route-model-picker-provider';
import { useLocalAssets } from '../chat/capability-settings-shared';
import { TESTER_AI_SCOPE_REF } from './tester-ai-config';

export type TesterSettingsPanelProps = {
  open: boolean;
  onClose: () => void;
  config: AIConfig;
};

// Canonical tester enabled capabilities (§ 5 § 11 closeout predicate).
// Order mirrors the Wave 3 preflight acceptance invariant.
const TESTER_ENABLED_CAPABILITIES = [
  'text.generate',
  'text.embed',
  'audio.synthesize',
  'audio.transcribe',
  'voice_workflow.tts_v2v',
  'voice_workflow.tts_t2v',
  'image.generate',
  'image.edit',
  'video.generate',
  'world.generate',
] as const;

export function TesterSettingsPanel(props: TesterSettingsPanelProps) {
  const { open, onClose, config } = props;
  const { t } = useTranslation();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const aiConfigService = useMemo(() => getDesktopAIConfigService(), []);
  const assetsQuery = useLocalAssets();

  const surface: AppModelConfigSurface = useMemo(() => ({
    scopeRef: TESTER_AI_SCOPE_REF,
    aiConfigService,
    enabledCapabilities: TESTER_ENABLED_CAPABILITIES,
    providerResolver: (routeCapability: string) => getDesktopRouteModelPickerProvider(routeCapability),
    projectionResolver: () => null,
    runtimeReady: true,
    localAssetSource: {
      list: () => assetsQuery.data || [],
      loading: assetsQuery.isLoading,
    },
    i18n: { t },
  }), [aiConfigService, assetsQuery.data, assetsQuery.isLoading, t]);
  const profileCopy = useMemo(() => defaultModelConfigProfileCopy(t), [t]);
  const userProfilesSource = useMemo(() => ({ list: () => loadUserProfiles() }), []);
  const currentOrigin = useMemo(
    () => (config.profileOrigin
      ? { profileId: config.profileOrigin.profileId, title: config.profileOrigin.title }
      : null),
    [config.profileOrigin?.profileId, config.profileOrigin?.title],
  );
  const handleManageProfiles = useCallback(() => {
    setActiveTab('runtime');
    setTimeout(() => dispatchRuntimeConfigOpenPage('profiles'), 100);
  }, [setActiveTab]);

  const profile = useModelConfigProfileController({
    scopeRef: TESTER_AI_SCOPE_REF,
    aiConfigService,
    copy: profileCopy,
    applyAIProfileToConfig,
    userProfilesSource,
    currentOrigin,
    onManage: handleManageProfiles,
  });

  if (!open) {
    return null;
  }

  return (
    <aside
      className="mr-2 flex min-h-0 w-[400px] shrink-0 flex-col"
      data-right-panel="tester-settings"
    >
      <DesktopCardSurface
        kind="promoted-glass"
        as="section"
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div className="flex items-start gap-3 border-b border-white/70 px-4 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
              {t('Tester.settings.title', { defaultValue: 'AI Tester Settings' })}
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--nimi-text-secondary)]">
              {t('Chat.settingsSubtitle', { defaultValue: 'Global interaction preferences' })}
            </p>
          </div>
          <DesktopIconToggleAction
            icon={(
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            )}
            aria-label={t('Chat.closePanel', { defaultValue: 'Close panel' })}
            title={t('Chat.closePanel', { defaultValue: 'Close panel' })}
            onClick={onClose}
          />
        </div>

        <ScrollArea className={cn('min-h-0 flex-1')}>
          <div className="px-3 py-3">
            <ModelConfigAiModelHub surface={surface} profile={profile} />
          </div>
        </ScrollArea>
      </DesktopCardSurface>
    </aside>
  );
}
