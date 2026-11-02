import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@nimiplatform/kit/ui';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

/** Shared placement and input behavior only; each subject owns its data/actions. */
export function ChatAvatarPopover({ open, onOpenChange, placement, onSelect, label, testId, className, trigger: triggerNode, children }: {
  open: boolean; onOpenChange: (open: boolean) => void; placement: 'composer' | 'rail' | 'message';
  onSelect?: () => void; label: string; testId: string; className: string; trigger: ReactElement; children: ReactNode;
}) {
  const { clock } = useDesktopRendererBindings();
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const timer = useRef<(() => void) | null>(null);
  const keyboardEntry = useRef(false);
  const restoreFocus = useRef(false);
  const dismissed = useRef(false);
  const cancel = () => { timer.current?.(); timer.current = null; };
  const enter = () => {
    if (keyboardEntry.current && content.current?.isConnected) { content.current.focus(); keyboardEntry.current = false; }
  };
  const schedule = (next: boolean) => {
    cancel();
    if (next && dismissed.current) return;
    timer.current = clock.schedule(next ? 180 : 200, result => {
      if (result.ok && (next || !content.current?.contains(document.activeElement))) onOpenChange(next);
    });
  };
  useEffect(() => { if (!open) cancel(); }, [open]);
  useEffect(() => () => timer.current?.(), []);
  return <Popover open={open} onOpenChange={next => { cancel(); if (!next) dismissed.current = true; onOpenChange(next); }}>
    <PopoverTrigger asChild ref={trigger} onMouseEnter={() => { dismissed.current = false; schedule(true); }} onMouseLeave={() => { dismissed.current = false; schedule(false); }}
      onFocus={() => schedule(true)} onBlur={() => { dismissed.current = false; schedule(false); }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); cancel(); dismissed.current = false; keyboardEntry.current = true; onOpenChange(true); enter(); }
        if (event.key === 'Escape') { event.preventDefault(); cancel(); dismissed.current = true; onOpenChange(false); }
      }} onClick={event => {
        event.preventDefault(); cancel(); dismissed.current = false;
        if (placement === 'rail') { onOpenChange(false); onSelect?.(); } else onOpenChange(true);
      }}>{triggerNode}</PopoverTrigger>
    <PopoverContent side={placement === 'rail' ? 'left' : 'top'} align={placement === 'rail' ? 'center' : 'start'} sideOffset={10}
      onMouseEnter={cancel} onMouseLeave={() => schedule(false)}
      onOpenAutoFocus={event => { event.preventDefault(); enter(); }}
      onCloseAutoFocus={event => { event.preventDefault(); if (restoreFocus.current) { trigger.current?.focus(); cancel(); restoreFocus.current = false; } }} className={className}>
      <div ref={node => { content.current = node; enter(); }} tabIndex={-1} data-testid={testId} aria-label={label} className="outline-none"
        onFocusCapture={cancel} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) schedule(false); }}
        onKeyDownCapture={event => { if (event.key === 'Escape') { dismissed.current = true; restoreFocus.current = true; } }}>{children}</div>
    </PopoverContent>
  </Popover>;
}
