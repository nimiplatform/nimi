import { useState } from 'react';
import { createNimiClientId } from '@nimiplatform/sdk';
import { Button, InlineAlert, LoadingSkeleton, StatusBadge } from '@nimiplatform/kit/ui';

import { useTranslation } from '../../shell/i18n/index.js';
import { useLabRendererHost } from '../../renderer/context.js';
import type { LabTextConversationDocument } from './text-conversation.js';

/** Export the unchanged source document, including data not sent after a reset. */
export function LabConversationExport(props: {
  readonly document: LabTextConversationDocument | null;
  readonly disabled: boolean;
  readonly filename: string;
}) {
  const host = useLabRendererHost();
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<{ readonly ok: boolean; readonly path?: string; readonly revealed?: boolean } | null>(null);
  const assets = host.sdk.localAppClient.storage.assets;
  return (
    <div className="lab-realtime__row">
      <Button type="button" size="sm" tone="secondary" disabled={props.disabled || exporting || !props.document?.messages.length}
        onClick={async () => {
          if (!props.document) return;
          const body = JSON.stringify(props.document, null, 2);
          setExporting(true);
          setNotice(null);
          try {
            const asset = await assets.write({
              relativePath: `exports/${createNimiClientId('chat')}-${props.filename}`,
              body: new TextEncoder().encode(body), mediaType: 'application/json', overwrite: false,
            });
            try {
              await assets.reveal(asset.relativePath);
              setNotice({ ok: true, path: asset.relativePath, revealed: true });
            } catch { setNotice({ ok: true, path: asset.relativePath, revealed: false }); }
          } catch { setNotice({ ok: false }); }
          finally { setExporting(false); }
        }}>
        {t(exporting ? 'CapabilityTests.textConversation.exporting' : 'CapabilityTests.textConversation.export')}
      </Button>
      {notice ? <InlineAlert tone={notice.ok ? 'success' : 'warning'}>{t(notice.ok
        ? notice.revealed ? 'CapabilityTests.textConversation.exported' : 'CapabilityTests.textConversation.exportSaved'
        : 'CapabilityTests.textConversation.exportFailed', { filename: notice.path })}</InlineAlert> : null}
      {notice?.ok && !notice.revealed && notice.path ? <Button type="button" size="sm" tone="ghost" disabled={exporting}
        onClick={async () => {
          setExporting(true);
          try { await assets.reveal(notice.path!); setNotice({ ...notice, revealed: true }); }
          catch { setNotice({ ...notice, revealed: false }); }
          finally { setExporting(false); }
        }}>{t('CapabilityTests.textConversation.revealExport')}</Button> : null}
    </div>
  );
}

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
