import { useEffect, useRef, useState } from 'react';
import { Button } from '@nimiplatform/kit/ui';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

export function MyHandleShareCard({ handle, title }: { handle: string; title?: string }) {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const normalized = handle.trim().replace(/^@+/, '');
  if (!normalized) return null;
  const displayHandle = `@${normalized}`;

  const copyHandle = async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    try {
      if (bindings.app?.commands?.writeClipboardText) {
        await bindings.app.commands.writeClipboardText(displayHandle);
      } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(displayHandle);
      } else {
        throw new Error('Clipboard unavailable');
      }
      setStatus('copied');
      timer.current = setTimeout(() => {
        timer.current = null;
        setStatus('idle');
      }, 2000);
    } catch {
      setStatus('failed');
    }
  };

  return (
    <div
      data-testid="my-handle-share-card"
      className="flex items-center justify-between gap-2.5 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 py-2.5"
    >
      <div className="min-w-0 flex-1 text-left">
        <p className="text-[11px] font-medium text-[var(--nimi-text-secondary)]">
          {title ?? t('Relationship.contacts.myUsernameLabel')}
        </p>
        <p className="mt-0.5 truncate font-mono text-xs font-medium text-[var(--nimi-text-primary)]">
          {displayHandle}
        </p>
        {status === 'failed' ? (
          <p role="alert" className="mt-1 text-[11px] text-[var(--nimi-status-danger-soft-text)]">
            {t('Relationship.contacts.copyUsernameFailed')}
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        size="sm"
        tone="secondary"
        leadingIcon={status === 'copied' ? <Check size={13} /> : <Copy size={13} />}
        onClick={() => { void copyHandle(); }}
      >
        {status === 'copied' ? t('Relationship.contacts.usernameCopied') : t('Relationship.contacts.copyUsername')}
      </Button>
    </div>
  );
}
