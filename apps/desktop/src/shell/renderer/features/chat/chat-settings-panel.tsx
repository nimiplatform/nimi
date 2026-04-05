import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { getPlatformClient } from '@nimiplatform/sdk';
import {
  CanonicalDrawerSection,
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
  /** Called when the user changes the model/route selection. */
  onModelSelectionChange?: (selection: RouteModelPickerSelection) => void;
  /** Initial model selection to restore. */
  initialModelSelection?: Partial<RouteModelPickerSelection>;
  chatRouteConfigContent?: ReactNode;
  voiceRouteConfigContent?: ReactNode;
  mediaRouteConfigContent?: ReactNode;
  presenceContent?: ReactNode;
  thinkingPreference?: ChatThinkingPreference;
  thinkingSupported?: boolean;
  thinkingUnsupportedReason?: string | null;
  onThinkingPreferenceChange?: (next: ChatThinkingPreference) => void;
  unavailableReason?: string;
};

function DisabledSettingsNote(props: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-3 py-4 text-center text-[11px] text-gray-500">
      {props.label}
    </div>
  );
}

export function ChatSettingsPanel({
  headerSlot,
  onModelSelectionChange,
  initialModelSelection,
  chatRouteConfigContent,
  voiceRouteConfigContent,
  mediaRouteConfigContent,
  presenceContent,
  thinkingPreference = 'off',
  thinkingSupported = false,
  thinkingUnsupportedReason,
  onThinkingPreferenceChange,
  unavailableReason,
}: ChatSettingsPanelProps) {
  const { t } = useTranslation();
  const [chatRouteOpen, setChatRouteOpen] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(true);
  const [voiceRouteOpen, setVoiceRouteOpen] = useState(false);
  const [visualRouteOpen, setVisualRouteOpen] = useState(false);

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
  const resolvedUnavailableReason = unavailableReason || t('Chat.settingsUnavailableReason', {
    defaultValue: 'This source does not expose runtime inspect yet.',
  });
  const normalizedThinkingReason = String(thinkingUnsupportedReason || '').trim() || null;

  return (
    <div className="space-y-5">
      {headerSlot}

      <CanonicalDrawerSection
        title={t('Chat.settingsChatModel', { defaultValue: 'Chat Model' })}
        hint={t('Chat.settingsChatModelHint', { defaultValue: 'AI model used for this conversation. Follows Runtime default unless overridden.' })}
      >
        {providerRef.current ? (
          <RouteModelPickerPanel {...panelProps} className="rounded-xl" />
        ) : (
          <DisabledSettingsNote label={t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' })} />
        )}
        {chatRouteConfigContent ? (
          <CanonicalSettingsCollapsibleSection
            title={t('Chat.settingsChatRouteConfig', { defaultValue: 'Model route config' })}
            open={chatRouteOpen}
            onToggle={() => setChatRouteOpen((value) => !value)}
          >
            {chatRouteConfigContent}
          </CanonicalSettingsCollapsibleSection>
        ) : null}
      </CanonicalDrawerSection>

      <CanonicalDrawerSection
        title={t('Chat.settingsThinkingTitle', { defaultValue: 'Thinking' })}
        hint={t('Chat.settingsThinkingHint', { defaultValue: 'Enable model thinking when the current route supports separate reasoning output.' })}
      >
        <CanonicalSettingsCollapsibleSection
          title={t('Chat.settingsThinkingConfig', { defaultValue: 'Thinking mode' })}
          open={thinkingOpen}
          onToggle={() => setThinkingOpen((value) => !value)}
        >
          <div className="space-y-3">
            <div>
              <p className="mb-2 text-xs font-semibold text-gray-500">
                {t('Chat.settingsThinkingModeLabel', { defaultValue: 'Mode' })}
              </p>
              <div className="flex flex-wrap gap-2 rounded-2xl bg-[#eef5f5] p-1.5">
                <CanonicalSettingsSegmentButton
                  active={thinkingPreference === 'off'}
                  onClick={() => onThinkingPreferenceChange?.('off')}
                >
                  {t('Chat.settingsThinkingOff', { defaultValue: 'Off' })}
                </CanonicalSettingsSegmentButton>
                <CanonicalSettingsSegmentButton
                  active={thinkingPreference === 'on'}
                  disabled={!thinkingSupported}
                  onClick={() => onThinkingPreferenceChange?.('on')}
                >
                  {t('Chat.settingsThinkingOn', { defaultValue: 'Thinking' })}
                </CanonicalSettingsSegmentButton>
              </div>
            </div>
            <CanonicalSettingsToggleRow
              label={t('Chat.settingsThinkingLabel', { defaultValue: 'Show thinking for supported routes' })}
              hint={thinkingSupported
                ? t('Chat.settingsThinkingReadyHint', { defaultValue: 'This route can stream the model thought process separately from the final answer.' })
                : (normalizedThinkingReason || t('Chat.settingsThinkingFallbackHint', { defaultValue: 'Thinking is unavailable for the current route.' }))}
              checked={thinkingPreference === 'on'}
              disabled={!thinkingSupported}
              onChange={(checked) => onThinkingPreferenceChange?.(checked ? 'on' : 'off')}
            />
            {normalizedThinkingReason ? (
              <DisabledSettingsNote label={normalizedThinkingReason} />
            ) : null}
          </div>
        </CanonicalSettingsCollapsibleSection>
      </CanonicalDrawerSection>

      <CanonicalDrawerSection
        title={t('Chat.settingsVoice', { defaultValue: 'Voice' })}
        hint={t('Chat.settingsVoiceHint', { defaultValue: 'Control how voice replies are triggered, whether voice session mode stays on, and which timbre is used.' })}
      >
        <div>
          <p className="mb-2 text-xs font-semibold text-gray-500">
            {t('Chat.settingsVoiceTrigger', { defaultValue: 'Trigger' })}
          </p>
          <div className="flex flex-wrap gap-2 rounded-2xl bg-[#eef5f5] p-1.5">
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
        <CanonicalSettingsCollapsibleSection
          title={t('Chat.settingsVoiceRouteConfig', { defaultValue: 'Voice model config' })}
          open={voiceRouteOpen}
          onToggle={() => setVoiceRouteOpen((value) => !value)}
        >
          {voiceRouteConfigContent || <DisabledSettingsNote label={resolvedUnavailableReason} />}
        </CanonicalSettingsCollapsibleSection>
      </CanonicalDrawerSection>

      <CanonicalDrawerSection
        title={t('Chat.settingsVisuals', { defaultValue: 'Visuals' })}
        hint={t('Chat.settingsVisualsHint', { defaultValue: 'Control whether images and videos appear in conversation, and their content style.' })}
      >
        <div>
          <p className="mb-2 text-xs font-semibold text-gray-500">
            {t('Chat.settingsVisualsTrigger', { defaultValue: 'Trigger' })}
          </p>
          <div className="flex flex-wrap gap-2 rounded-2xl bg-[#eef5f5] p-1.5">
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
        </div>
        <CanonicalSettingsCollapsibleSection
          title={t('Chat.settingsMediaRouteConfig', { defaultValue: 'Visual route config' })}
          open={visualRouteOpen}
          onToggle={() => setVisualRouteOpen((value) => !value)}
        >
          {mediaRouteConfigContent || <DisabledSettingsNote label={resolvedUnavailableReason} />}
        </CanonicalSettingsCollapsibleSection>
      </CanonicalDrawerSection>

      <CanonicalDrawerSection
        title={t('Chat.settingsPresence', { defaultValue: 'Presence' })}
        hint={t('Chat.settingsPresenceHint', { defaultValue: 'Control whether this conversation may proactively re-enter the room.' })}
      >
        {presenceContent || (
          <CanonicalSettingsToggleRow
            label={t('Chat.settingsAllowProactiveContact', { defaultValue: 'Allow proactive contact' })}
            hint={t('Chat.settingsAllowProactiveContactHint', { defaultValue: 'Unavailable until runtime inspect is connected for this source.' })}
            checked={false}
            disabled
          />
        )}
      </CanonicalDrawerSection>
    </div>
  );
}
