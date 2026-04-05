import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getPlatformClient } from '@nimiplatform/sdk';
import { CanonicalDrawerSection } from '@nimiplatform/nimi-kit/features/chat';
import {
  createSdkRouteDataProvider,
  useRouteModelPickerData,
  type RouteModelPickerSelection,
} from '@nimiplatform/nimi-kit/features/model-picker';
import { RouteModelPickerPanel } from '@nimiplatform/nimi-kit/features/model-picker/ui';

type ChatSettingsPanelProps = {
  /** Extra content rendered above the model section (e.g. agent selector). */
  headerSlot?: React.ReactNode;
  /** Called when the user changes the model/route selection. */
  onModelSelectionChange?: (selection: RouteModelPickerSelection) => void;
  /** Initial model selection to restore. */
  initialModelSelection?: Partial<RouteModelPickerSelection>;
};

function PlaceholderSection(props: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-3 py-4 text-center text-[11px] text-gray-400">
      {props.label}
    </div>
  );
}

export function ChatSettingsPanel({
  headerSlot,
  onModelSelectionChange,
  initialModelSelection,
}: ChatSettingsPanelProps) {
  const { t } = useTranslation();

  const providerRef = useRef<ReturnType<typeof createSdkRouteDataProvider> | null>(null);
  if (!providerRef.current) {
    try {
      providerRef.current = createSdkRouteDataProvider(getPlatformClient().runtime);
    } catch {
      // Runtime not ready yet — will show loading state
    }
  }

  const { panelProps } = useRouteModelPickerData({
    provider: providerRef.current!,
    capability: 'text.generate',
    initialSelection: initialModelSelection,
    onSelectionChange: onModelSelectionChange,
    labels: useMemo(() => ({
      source: t('Chat.settingsSource', { defaultValue: 'Source' }),
      local: t('Chat.settingsLocal', { defaultValue: 'Local' }),
      cloud: t('Chat.settingsCloud', { defaultValue: 'Cloud' }),
      connector: t('Chat.settingsConnector', { defaultValue: 'Connector' }),
      model: t('Chat.settingsModel', { defaultValue: 'Model' }),
      loading: t('Chat.settingsLoading', { defaultValue: 'Loading models...' }),
    }), [t]),
  });

  return (
    <div className="space-y-5">
      {headerSlot}

      {/* Chat Model */}
      <CanonicalDrawerSection
        title={t('Chat.settingsChatModel', { defaultValue: 'Chat Model' })}
        hint={t('Chat.settingsChatModelHint', { defaultValue: 'AI model used for this conversation. Follows Runtime default unless overridden.' })}
      >
        {providerRef.current ? (
          <RouteModelPickerPanel {...panelProps} className="rounded-xl" />
        ) : (
          <PlaceholderSection label={t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' })} />
        )}
      </CanonicalDrawerSection>

      {/* Voice — placeholder */}
      <CanonicalDrawerSection
        title={t('Chat.settingsVoice', { defaultValue: 'Voice' })}
        hint={t('Chat.settingsVoiceHint', { defaultValue: 'Control how voice replies are triggered and which timbre is used.' })}
      >
        <PlaceholderSection label={t('Chat.settingsComingSoon', { defaultValue: 'Coming soon' })} />
      </CanonicalDrawerSection>

      {/* Visuals — placeholder */}
      <CanonicalDrawerSection
        title={t('Chat.settingsVisuals', { defaultValue: 'Visuals' })}
        hint={t('Chat.settingsVisualsHint', { defaultValue: 'Control whether images and videos appear in conversation.' })}
      >
        <PlaceholderSection label={t('Chat.settingsComingSoon', { defaultValue: 'Coming soon' })} />
      </CanonicalDrawerSection>
    </div>
  );
}
