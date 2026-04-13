import { useRef, useState } from 'react';
import type { ConversationTargetSummary } from '@nimiplatform/nimi-kit/features/chat';
import { ScrollArea } from '@nimiplatform/nimi-kit/ui';
import { E2E_IDS } from '@renderer/testability/e2e-ids';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChatContactsSidebarProps = {
  targets: readonly ConversationTargetSummary[];
  selectedTargetId: string | null;
  onSelectTarget: (targetId: string) => void;
};

// ---------------------------------------------------------------------------
// Tooltip (reuses pattern from SidebarTooltipButton)
// ---------------------------------------------------------------------------

function ContactTooltip({ label, pos }: { label: string; pos: { top: number; right: number } }) {
  return (
    <span
      className="pointer-events-none fixed z-[9999] whitespace-nowrap rounded-md bg-[#4ECCA3] px-2 py-1 text-xs text-white shadow-lg"
      style={{ top: pos.top, right: pos.right, transform: 'translateY(-50%)' }}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Single contact avatar button
// ---------------------------------------------------------------------------

function ContactAvatar({
  target,
  selected,
  onSelect,
}: {
  target: ConversationTargetSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; right: number } | null>(null);

  const initial = (target.avatarFallback || target.title || '?').charAt(0).toUpperCase();
  const unread = target.unreadCount && target.unreadCount > 0 ? target.unreadCount : null;
  const testId = target.source === 'human'
    ? E2E_IDS.chatRow(String(target.canonicalSessionId || target.id))
    : target.source === 'agent' || target.source === 'ai'
      ? E2E_IDS.chatTarget(String(target.id))
      : undefined;

  const handleMouseEnter = () => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setTooltipPos({ top: rect.top + rect.height / 2, right: window.innerWidth - rect.left + 10 });
    }
  };

  return (
    <>
      <div className="group relative flex h-11 items-center">
        {/* Selection indicator — Discord-style right pill, outside the avatar */}
        <div
          className={`absolute right-0 w-[3px] rounded-l-full bg-emerald-500 transition-all duration-200 ${
            selected
              ? 'h-8'
              : 'h-0 group-hover:h-4'
          }`}
        />

        {/* Avatar button — offset left to leave space for the pill */}
        <button
          ref={ref}
          type="button"
          data-testid={testId}
          onClick={onSelect}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={() => setTooltipPos(null)}
          className={`relative mx-2 flex h-10 w-10 items-center justify-center overflow-hidden transition-all duration-200 ${
            selected ? 'rounded-2xl' : 'rounded-full hover:rounded-2xl'
          }`}
          aria-label={target.title}
        >
          {target.avatarUrl ? (
            <img
              src={target.avatarUrl}
              alt={target.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              className={`flex h-full w-full items-center justify-center text-sm font-semibold ${
                target.source === 'ai'
                  ? 'bg-gradient-to-br from-sky-400 to-teal-500 text-white'
                  : target.source === 'agent'
                    ? 'bg-gradient-to-br from-emerald-400 to-teal-600 text-white'
                    : 'bg-gradient-to-br from-violet-400 to-indigo-500 text-white'
              }`}
            >
              {initial}
            </div>
          )}

          {/* Unread badge */}
          {unread ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white shadow-sm">
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </button>
      </div>

      {tooltipPos ? <ContactTooltip label={target.title} pos={tooltipPos} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Separator
// ---------------------------------------------------------------------------

function SidebarSeparator() {
  return <div className="mx-auto my-1.5 h-px w-7 rounded-full bg-slate-200/80" />;
}

// ---------------------------------------------------------------------------
// Section label (optional, for source grouping)
// ---------------------------------------------------------------------------

export function ChatContactsSidebar({ targets, selectedTargetId, onSelectTarget }: ChatContactsSidebarProps) {
  const aiTargets = targets.filter((t) => t.source === 'ai');
  const humanTargets = targets.filter((t) => t.source === 'human');
  const agentTargets = targets.filter((t) => t.source === 'agent');

  return (
    <aside data-testid={E2E_IDS.chatList} className="flex h-full w-14 shrink-0 flex-col items-center border-l border-slate-200/60 bg-[var(--nimi-app-background,#f3f1ee)] py-2">
      <ScrollArea
        className="w-full flex-1 px-1 py-1"
        viewportClassName="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        contentClassName="flex flex-col items-center gap-1.5"
      >
        {/* AI targets (always visible) */}
        {aiTargets.map((target) => (
          <ContactAvatar
            key={target.id}
            target={target}
            selected={selectedTargetId === target.id}
            onSelect={() => onSelectTarget(target.id)}
          />
        ))}

        {/* Human contacts */}
        {humanTargets.length > 0 ? (
          <>
            <SidebarSeparator />
            {humanTargets.map((target) => (
              <ContactAvatar
                key={target.id}
                target={target}
                selected={selectedTargetId === target.id}
                onSelect={() => onSelectTarget(target.id)}
              />
            ))}
          </>
        ) : null}

        {/* Agent friends */}
        {agentTargets.length > 0 ? (
          <>
            <SidebarSeparator />
            {agentTargets.map((target) => (
              <ContactAvatar
                key={target.id}
                target={target}
                selected={selectedTargetId === target.id}
                onSelect={() => onSelectTarget(target.id)}
              />
            ))}
          </>
        ) : null}
      </ScrollArea>
    </aside>
  );
}
