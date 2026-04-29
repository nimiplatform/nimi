import type { ReactNode } from 'react';
import { ScrollArea, cn } from '@nimiplatform/nimi-kit/ui';
import { useTranslation } from 'react-i18next';
import { DesktopIconToggleAction } from '@renderer/components/action';
import { DesktopCardSurface } from '@renderer/components/surface';
import { EntityAvatar } from '@renderer/components/entity-avatar';

export type ChatSideSheetProps = {
  title: ReactNode;
  /** Small uppercase kicker rendered above the title (e.g. "Agent Center"). When set,
   *  the title is treated as the primary heading (larger), and the subtitle is rendered
   *  as a tertiary mono handle line. Without it the sheet falls back to a flat 2-line
   *  title + subtitle layout. */
  eyebrow?: string;
  /** Optional avatar (image URL + fallback letter) shown to the left of the eyebrow/title block.
   *  Only rendered when {@link ChatSideSheetProps.eyebrow} is also present so the visual
   *  hierarchy stays coherent. Pass `avatarUrl=null` to render fallback only. */
  avatarUrl?: string | null;
  avatarFallback?: string;
  avatarAlt?: string;
  subtitle?: ReactNode;
  /** Optional world / worldview label rendered as a chip on the same line as the handle. */
  world?: string | null;
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
    ? 'w-[min(500px,calc(100vw-96px))]'
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
        <div className="flex items-start gap-3 border-b border-white/70 px-4 pb-3.5 pt-7">
          {props.eyebrow && (props.avatarUrl !== undefined || props.avatarFallback) ? (
            <EntityAvatar
              kind="agent"
              imageUrl={props.avatarUrl ?? null}
              name={props.avatarAlt ?? (typeof props.title === 'string' ? props.title : 'Agent')}
              sizeClassName="h-14 w-14"
              textClassName="text-[18px] font-semibold"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            {props.eyebrow ? (
              <>
                <p className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
                  {props.eyebrow}
                </p>
                <h2 className="m-0 truncate text-[15px] font-semibold tracking-tight text-[var(--nimi-text-primary)]">
                  {props.title}
                </h2>
                {(props.subtitle || props.world) ? (
                  <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                    {props.subtitle ? (
                      <span className="truncate font-mono text-[11.5px] text-[var(--nimi-text-secondary)]">{props.subtitle}</span>
                    ) : null}
                    {props.world ? (
                      <span className="inline-flex max-w-full shrink-0 items-center gap-1 rounded-full border border-[color-mix(in_srgb,#a855f7_30%,transparent)] bg-[color-mix(in_srgb,#a855f7_8%,transparent)] px-2 py-px text-[10.5px] font-medium text-[#7c3aed]">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="2" y1="12" x2="22" y2="12" />
                          <path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10z" />
                        </svg>
                        <span className="truncate">{props.world}</span>
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <h2 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{props.title}</h2>
                {props.subtitle ? (
                  <p className="mt-1 text-xs leading-5 text-[var(--nimi-text-secondary)]">{props.subtitle}</p>
                ) : null}
              </>
            )}
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
