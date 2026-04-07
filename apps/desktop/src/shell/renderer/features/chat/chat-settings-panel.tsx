import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { getPlatformClient } from '@nimiplatform/sdk';
import {
  CanonicalSettingsCollapsibleSection,
  CanonicalSettingsSegmentButton,
  CanonicalSettingsToggleRow,
} from '@nimiplatform/nimi-kit/features/chat';
import {
  createSdkRouteDataProvider,
  useRouteModelPickerData,
  type RouteModelPickerSelection,
} from '@nimiplatform/nimi-kit/features/model-picker';
import { RouteModelPickerPanel } from '@nimiplatform/nimi-kit/features/model-picker/ui';
import type { ChatThinkingPreference } from './chat-thinking';

type ChatSettingsPanelProps = {
  /** Extra content rendered above the model section (e.g. agent selector). */
  headerSlot?: ReactNode;
  /** Optional custom model picker content for sources that own their own route options. */
  modelPickerContent?: ReactNode;
  /** Called when the user changes the model/route selection. */
  onModelSelectionChange?: (selection: RouteModelPickerSelection) => void;
  /** Initial model selection to restore. */
  initialModelSelection?: Partial<RouteModelPickerSelection>;
  chatRouteConfigContent?: ReactNode;
  voiceRouteConfigContent?: ReactNode;
  mediaRouteConfigContent?: ReactNode;
  diagnosticsContent?: ReactNode;
  presenceContent?: ReactNode;
  thinkingPreference?: ChatThinkingPreference;
  thinkingSupported?: boolean;
  thinkingUnsupportedReason?: string | null;
  onThinkingPreferenceChange?: (next: ChatThinkingPreference) => void;
  unavailableReason?: string;
};

export type RoutePickerLabels = {
  source: string;
  local: string;
  cloud: string;
  connector: string;
  model: string;
  active: string;
  reset: string;
  loading: string;
  unavailable: string;
  runtimeNotReady: string;
  localUnavailable: string;
  noLocalModels: string;
  selectConnector: string;
  noCloudModels: string;
  savedRouteUnavailable: string;
};

function SettingsSection(props: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
        {props.title}
      </h3>
      {props.children}
      <div className="border-b border-slate-100" />
    </div>
  );
}

export function DisabledSettingsNote(props: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-3 py-4 text-center text-[11px] text-gray-500">
      {props.label}
    </div>
  );
}

export function buildRoutePickerLabels(
  t: ReturnType<typeof useTranslation>['t'],
): RoutePickerLabels {
  return {
    source: t('Chat.settingsSource', { defaultValue: 'Source' }),
    local: t('Chat.settingsLocal', { defaultValue: 'Local' }),
    cloud: t('Chat.settingsCloud', { defaultValue: 'Cloud' }),
    connector: t('Chat.settingsConnector', { defaultValue: 'Connector' }),
    model: t('Chat.settingsModel', { defaultValue: 'Model' }),
    active: t('Chat.settingsActive', { defaultValue: 'Active' }),
    reset: t('Chat.settingsReset', { defaultValue: 'Reset' }),
    loading: t('Chat.settingsLoading', { defaultValue: 'Loading models...' }),
    unavailable: t('Chat.settingsUnavailable', { defaultValue: 'Unavailable' }),
    runtimeNotReady: t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' }),
    localUnavailable: t('Chat.settingsLocalUnavailable', { defaultValue: 'Local model discovery failed. Runtime may be unavailable.' }),
    noLocalModels: t('Chat.settingsNoLocalModels', { defaultValue: 'No local models available for this capability.' }),
    selectConnector: t('Chat.settingsSelectConnector', { defaultValue: 'Select a connector to see available models.' }),
    noCloudModels: t('Chat.settingsNoCloudModels', { defaultValue: 'No models available for this connector.' }),
    savedRouteUnavailable: t('Chat.settingsSavedRouteUnavailable', { defaultValue: 'Saved route is no longer available.' }),
  };
}

export function CapabilityRouteModelPickerContent(input: {
  capability: string;
  initialModelSelection?: Partial<RouteModelPickerSelection>;
  onModelSelectionChange?: (selection: RouteModelPickerSelection) => void;
  labels: RoutePickerLabels;
}) {
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
    capability: input.capability,
    initialSelection: input.initialModelSelection,
    onSelectionChange: input.onModelSelectionChange,
    labels: input.labels,
  });

  if (!providerRef.current) {
    return <DisabledSettingsNote label={input.labels.runtimeNotReady} />;
  }

  return <RouteModelPickerPanel {...panelProps} className="rounded-xl" />;
}

function DefaultRouteModelPickerContent(input: {
  initialModelSelection?: Partial<RouteModelPickerSelection>;
  onModelSelectionChange?: (selection: RouteModelPickerSelection) => void;
  labels: RoutePickerLabels;
}) {
  return (
    <CapabilityRouteModelPickerContent
      capability="text.generate"
      initialModelSelection={input.initialModelSelection}
      onModelSelectionChange={input.onModelSelectionChange}
      labels={input.labels}
    />
  );
}

export function ChatSettingsPanel({
  headerSlot,
  modelPickerContent,
  onModelSelectionChange,
  initialModelSelection,
  chatRouteConfigContent,
  voiceRouteConfigContent,
  mediaRouteConfigContent,
  diagnosticsContent,
  presenceContent,
  thinkingPreference = 'off',
  thinkingSupported = false,
  thinkingUnsupportedReason,
  onThinkingPreferenceChange,
  unavailableReason,
}: ChatSettingsPanelProps) {
  const { t } = useTranslation();
  const [voiceRouteOpen, setVoiceRouteOpen] = useState(false);
  const [visualRouteOpen, setVisualRouteOpen] = useState(false);
  const routePickerLabels = useMemo(() => buildRoutePickerLabels(t), [t]);
  const resolvedUnavailableReason = unavailableReason || t('Chat.settingsUnavailableReason', {
    defaultValue: 'This source does not expose runtime inspect yet.',
  });
  const normalizedThinkingReason = String(thinkingUnsupportedReason || '').trim() || null;

  return (
    <div className="space-y-5">
      {headerSlot}

      {/* Chat Model */}
      <SettingsSection title={t('Chat.settingsChatModel', { defaultValue: 'Chat Model' })}>
        {modelPickerContent || (
          <DefaultRouteModelPickerContent
            initialModelSelection={initialModelSelection}
            onModelSelectionChange={onModelSelectionChange}
            labels={routePickerLabels}
          />
        )}
        {chatRouteConfigContent ? (
          <div className="pt-1">
            {chatRouteConfigContent}
          </div>
        ) : null}
      </SettingsSection>

      {/* Thinking */}
      <SettingsSection title={t('Chat.settingsThinkingTitle', { defaultValue: 'Thinking' })}>
        <CanonicalSettingsToggleRow
          label={t('Chat.settingsThinkingLabel', { defaultValue: 'Show thinking for supported routes' })}
          hint={thinkingSupported
            ? t('Chat.settingsThinkingReadyHint', { defaultValue: 'This route can stream the model thought process separately from the final answer.' })
            : (normalizedThinkingReason || t('Chat.settingsThinkingFallbackHint', { defaultValue: 'Thinking is unavailable for the current route.' }))}
          checked={thinkingPreference === 'on'}
          disabled={!thinkingSupported}
          onChange={(checked) => onThinkingPreferenceChange?.(checked ? 'on' : 'off')}
        />
      </SettingsSection>

      {/* Voice */}
      <SettingsSection title={t('Chat.settingsVoice', { defaultValue: 'Voice' })}>
        <div className="flex flex-wrap gap-2 rounded-2xl bg-slate-100/80 p-1.5">
          <CanonicalSettingsSegmentButton active disabled>
            {t('Chat.settingsVoiceOff', { defaultValue: 'Off' })}
          </CanonicalSettingsSegmentButton>
          <CanonicalSettingsSegmentButton disabled>
            {t('Chat.settingsVoiceCommand', { defaultValue: 'Command' })}
          </CanonicalSettingsSegmentButton>
          <CanonicalSettingsSegmentButton disabled>
            {t('Chat.settingsVoiceNatural', { defaultValue: 'Natural' })}
          </CanonicalSettingsSegmentButton>
        </div>
        <CanonicalSettingsToggleRow
          label={t('Chat.settingsVoiceConversationMode', { defaultValue: 'Voice conversation mode' })}
          hint={t('Chat.settingsVoiceConversationModeHint', { defaultValue: 'When enabled, upcoming replies stay in a voice session until you turn it off.' })}
          checked={false}
          disabled
        />
        <CanonicalSettingsToggleRow
          label={t('Chat.settingsAutoPlayVoiceReplies', { defaultValue: 'Auto-play voice replies' })}
          hint={t('Chat.settingsAutoPlayVoiceRepliesHint', { defaultValue: 'Automatically play voice beats after they arrive.' })}
          checked={false}
          disabled
        />
        {voiceRouteConfigContent ? (
          <CanonicalSettingsCollapsibleSection
            title={t('Chat.settingsVoiceRouteConfig', { defaultValue: 'Voice model config' })}
            open={voiceRouteOpen}
            onToggle={() => setVoiceRouteOpen((value) => !value)}
          >
            {voiceRouteConfigContent}
          </CanonicalSettingsCollapsibleSection>
        ) : null}
      </SettingsSection>

      {/* Visuals */}
      <SettingsSection title={t('Chat.settingsVisuals', { defaultValue: 'Visuals' })}>
        <div className="flex flex-wrap gap-2 rounded-2xl bg-slate-100/80 p-1.5">
          <CanonicalSettingsSegmentButton active disabled>
            {t('Chat.settingsVisualsOff', { defaultValue: 'Off' })}
          </CanonicalSettingsSegmentButton>
          <CanonicalSettingsSegmentButton disabled>
            {t('Chat.settingsVisualsExplicitOnly', { defaultValue: 'Explicit only' })}
          </CanonicalSettingsSegmentButton>
          <CanonicalSettingsSegmentButton disabled>
            {t('Chat.settingsVisualsNatural', { defaultValue: 'Natural' })}
          </CanonicalSettingsSegmentButton>
        </div>
        {mediaRouteConfigContent ? (
          <CanonicalSettingsCollapsibleSection
            title={t('Chat.settingsMediaRouteConfig', { defaultValue: 'Visual route config' })}
            open={visualRouteOpen}
            onToggle={() => setVisualRouteOpen((value) => !value)}
          >
            {mediaRouteConfigContent}
          </CanonicalSettingsCollapsibleSection>
        ) : null}
      </SettingsSection>

      {/* Presence */}
      <SettingsSection title={t('Chat.settingsPresence', { defaultValue: 'Presence' })}>
        {presenceContent || (
          <CanonicalSettingsToggleRow
            label={t('Chat.settingsAllowProactiveContact', { defaultValue: 'Allow proactive contact' })}
            hint={t('Chat.settingsAllowProactiveContactHint', { defaultValue: 'Unavailable until runtime inspect is connected for this source.' })}
            checked={false}
            disabled
          />
        )}
      </SettingsSection>

      {/* Diagnostics */}
      <SettingsSection title={t('Chat.diagnosticsTitle', { defaultValue: 'Diagnostics' })}>
        {diagnosticsContent || (
          <DisabledSettingsNote label={resolvedUnavailableReason} />
        )}
      </SettingsSection>
    </div>
  );
}
