import type { ReactNode } from 'react';
import { ScrollArea, cn } from '@nimiplatform/nimi-kit/ui';
import { useTranslation } from 'react-i18next';
import { DesktopIconToggleAction } from '@renderer/components/action';
import { DesktopCardSurface } from '@renderer/components/surface';

export type ChatSideSheetProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  bodyClassName?: string;
  footer?: ReactNode;
  sheetKey: 'settings' | 'nimi-thread-list';
};

export function ChatSideSheet(props: ChatSideSheetProps) {
  const { t } = useTranslation();
  const widthClassName = props.sheetKey === 'settings'
    ? 'w-[min(460px,calc(100vw-96px))]'
    : 'w-[min(340px,calc(100vw-96px))]';

  return (
    <aside
      className={cn('mr-2 flex min-h-0 shrink-0', widthClassName, props.className)}
      data-chat-shared-side-sheet={props.sheetKey}
    >
      <DesktopCardSurface
        kind="promoted-glass"
        as="section"
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div className="flex items-start gap-3 border-b border-white/70 px-4 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{props.title}</h2>
            {props.subtitle ? (
              <p className="mt-1 text-xs leading-5 text-[var(--nimi-text-secondary)]">{props.subtitle}</p>
            ) : null}
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
            onClick={props.onClose}
          />
        </div>
        <ScrollArea
          className={cn(
            'min-h-0 flex-1 [&>[data-radix-scroll-area-viewport]>div]:!block',
            props.bodyClassName,
          )}
        >
          {props.children}
        </ScrollArea>
        {props.footer ? (
          <div className="border-t border-white/70 px-4 py-3">
            {props.footer}
          </div>
        ) : null}
      </DesktopCardSurface>
    </aside>
  );
}
