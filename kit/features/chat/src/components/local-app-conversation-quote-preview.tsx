import { X } from 'lucide-react';
import { Button, IconButton } from '@nimiplatform/kit/ui';
import type { LocalAppConversationQuote } from '../runtime/local-app-conversation-quote.js';
import { resolveChatCopy, type ChatCopy } from '../copy.js';

export function LocalAppConversationQuotePreview({ quote, copy, onReturnToComposer }: {
  quote: LocalAppConversationQuote;
  copy?: ChatCopy;
  onReturnToComposer?: () => void;
}) {
  const labels = resolveChatCopy(copy);
  const { state } = quote;
  if (state.status === 'empty') return null;
  return <div className="flex items-start gap-2 rounded-[var(--nimi-radius-sm)] bg-[var(--nimi-surface-panel)] px-3 py-2" data-canonical-quote-draft>
    <div className="min-w-0 flex-1 text-sm text-[var(--nimi-text-secondary)]">
      {state.status === 'preparing' ? <p role="status">{labels.quotePreparingLabel}</p> : state.status === 'error' ? <>
        <p role="status">{state.failure === 'too-long' ? labels.quoteTooLongLabel : state.failure === 'selection-changed' ? labels.quoteChangedLabel : state.failure === 'read' ? labels.quoteReadFailedLabel : labels.quoteFailedLabel}</p>
        {state.failure === 'read' ? <Button size="sm" tone="ghost" onClick={() => void quote.retry()}>{labels.quoteRetryLabel}</Button> : null}
      </> : <>
        <p className="text-xs">{state.sourceRole === 'app' ? labels.quoteAppSourceLabel : state.sourceRole === 'user' ? labels.bubbleUserLabel : labels.bubbleAssistantLabel}{state.sourcePartial ? ` · ${labels.quotePartialLabel}` : ''}</p>
        <details><summary className="cursor-pointer list-none truncate">{state.text}</summary><p className="max-h-36 overflow-y-auto whitespace-pre-wrap">{state.text}</p></details>
      </>}
    </div>
    <IconButton size="sm" tone="ghost" aria-label={labels.quoteCancelLabel} icon={<X size={16} />} onClick={() => { quote.cancel(); onReturnToComposer?.(); }} />
  </div>;
}
