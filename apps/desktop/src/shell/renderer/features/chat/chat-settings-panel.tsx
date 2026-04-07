import { useRef, useState, type ReactNode } from 'react';
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
import {
  ModelPickerModal,
  ModelSelectorTrigger,
} from '@nimiplatform/nimi-kit/features/model-picker/ui';
import type { RouteModelPickerDataProvider } from '@nimiplatform/nimi-kit/features/model-picker';

type ChatSettingsPanelProps = {
  headerSlot?: ReactNode;
  modelPickerContent?: ReactNode;
  onModelSelectionChange?: (selection: RouteModelPickerSelection) => void;
  initialModelSelection?: Partial<RouteModelPickerSelection>;
  voiceRouteConfigContent?: ReactNode;
  mediaRouteConfigContent?: ReactNode;
  diagnosticsContent?: ReactNode;
  presenceContent?: ReactNode;
  unavailableReason?: string;
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

function useModelPickerProvider(): RouteModelPickerDataProvider | null {
  const providerRef = useRef<RouteModelPickerDataProvider | null>(null);
  if (!providerRef.current) {
    try {
      providerRef.current = createSdkRouteDataProvider(getPlatformClient().runtime);
    } catch {
      // Runtime not ready
    }
  }
  return providerRef.current;
}

function useResolvedModelLabel(
  provider: RouteModelPickerDataProvider,
  capability: string,
  initialSelection?: Partial<RouteModelPickerSelection>,
): string | null {
  const { pickerState, selection } = useRouteModelPickerData({
    provider,
    capability,
    initialSelection,
  });
  const modelId = selection.model;
  if (!modelId) return null;
  const match = pickerState.models.find((m) => pickerState.adapter.getId(m) === modelId);
  return match ? pickerState.adapter.getTitle(match) : modelId;
}

function ModelSelectorWithModal(props: {
  capability: string;
  capabilityLabel: string;
  provider: RouteModelPickerDataProvider;
  initialSelection?: Partial<RouteModelPickerSelection>;
  onSelect: (selection: RouteModelPickerSelection) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [modalOpen, setModalOpen] = useState(false);

  const source = props.initialSelection?.source || null;
  const connector = props.initialSelection?.connectorId || null;
  const detail = source === 'cloud' && connector ? connector : null;
  const resolvedLabel = useResolvedModelLabel(props.provider, props.capability, props.initialSelection);

  return (
    <>
      <ModelSelectorTrigger
        source={source}
        modelLabel={resolvedLabel}
        detail={detail}
        placeholder={props.placeholder}
        onClick={() => setModalOpen(true)}
        disabled={props.disabled}
      />
      <ModelPickerModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        capability={props.capability}
        capabilityLabel={props.capabilityLabel}
        provider={props.provider}
        initialSelection={props.initialSelection}
        onSelect={props.onSelect}
      />
    </>
  );
}

export function ChatSettingsPanel({
  headerSlot,
  modelPickerContent,
  onModelSelectionChange,
  initialModelSelection,
  voiceRouteConfigContent,
  mediaRouteConfigContent,
  diagnosticsContent,
  presenceContent,
  unavailableReason,
}: ChatSettingsPanelProps) {
  const { t } = useTranslation();
  const [voiceRouteOpen, setVoiceRouteOpen] = useState(false);
  const [visualRouteOpen, setVisualRouteOpen] = useState(false);
  const provider = useModelPickerProvider();
  const resolvedUnavailableReason = unavailableReason || t('Chat.settingsUnavailableReason', {
    defaultValue: 'This source does not expose runtime inspect yet.',
  });

  return (
    <div className="space-y-5">
      {headerSlot}

      {/* Chat Model */}
      <SettingsSection title={t('Chat.settingsChatModel', { defaultValue: 'Chat Model' })}>
        {modelPickerContent || (provider && onModelSelectionChange ? (
          <ModelSelectorWithModal
            capability="text.generate"
            capabilityLabel={t('Chat.settingsChatModel', { defaultValue: 'Chat Model' })}
            provider={provider}
            initialSelection={initialModelSelection}
            onSelect={onModelSelectionChange}
            placeholder={t('Chat.settingsSelectModel', { defaultValue: 'Select a chat model' })}
          />
        ) : (
          <DisabledSettingsNote label={t('Chat.settingsRuntimeNotReady', { defaultValue: 'Runtime not ready' })} />
        ))}
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
