import { LoadingSkeleton, StatusBadge } from '@nimiplatform/kit/ui';

import { useTranslation } from '../../shell/i18n/index.js';

export type LabConversationDisplayMessage = {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly status?: 'failed' | 'stopped' | 'generating';
  readonly reasonCode?: string;
};

// The text-only transcript both conversation pages show.
export function LabConversationTranscript(props: {
  readonly messages: readonly LabConversationDisplayMessage[];
  readonly loading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section className="lab-realtime__card" aria-label={t('CapabilityTests.textConversation.transcript')}>
      {props.loading ? <LoadingSkeleton lines={3} label={t('Common.loading')} /> : null}
      {!props.loading && props.messages.length === 0 ? <p className="lab-realtime__meta">{t('CapabilityTests.textConversation.empty')}</p> : null}
      <ol className="lab-conversation__messages">
        {props.messages.map((message) => (
          <li key={message.id} className={`lab-conversation__message lab-conversation__message--${message.role}`}>
            <span className="lab-conversation__role">
              {t(message.role === 'user' ? 'CapabilityTests.textConversation.you' : 'CapabilityTests.textConversation.assistant')}
              {message.status ? (
                <StatusBadge tone={message.status === 'failed' ? 'danger' : message.status === 'generating' ? 'info' : 'neutral'} shape="dot">
                  {t(`CapabilityTests.textConversation.${message.status}`)}
                  {message.reasonCode ? ` · ${message.reasonCode}` : ''}
                </StatusBadge>
              ) : null}
            </span>
            <p className="lab-conversation__text">{message.text || '…'}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
