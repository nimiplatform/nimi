// Empty state — greeting for new conversation
// Direct mode: generic greeting without agent
// Agent mode: agent avatar + personalized greeting

import { useTranslation } from 'react-i18next';

interface EmptyStateProps {
  agentName?: string;
  agentAvatarUrl?: string;
}

export function EmptyState({ agentName, agentAvatarUrl }: EmptyStateProps) {
  const { t } = useTranslation();

  // Agent mode
  if (agentName) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center" style={{ paddingBottom: '10%' }}>
        {agentAvatarUrl ? (
          <img
            src={agentAvatarUrl}
            alt={agentName}
            className="w-16 h-16 rounded-full object-cover mb-4"
          />
        ) : (
          <div className="w-16 h-16 rounded-full bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_15%,transparent)] flex items-center justify-center mb-4">
            <span className="text-[24px] font-semibold text-[var(--nimi-action-primary-bg)]">
              {agentName.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        <p className="text-[14px] text-text-secondary">
          {t('chat.emptyHint', { name: agentName })}
        </p>
      </div>
    );
  }

  // Direct mode — minimal greeting
  return (
    <div className="flex flex-1 flex-col items-center justify-center" style={{ paddingBottom: '10%' }}>
      <p className="text-[18px] font-medium text-text-primary mb-1">
        {t('chat.directGreeting', 'How can I help you today?')}
      </p>
      <p className="text-[13px] text-text-muted">
        {t('chat.typeMessage')}
      </p>
    </div>
  );
}
