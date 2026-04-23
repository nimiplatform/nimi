import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { S } from '../../app-shell/page-style.js';

export function DentalRecordActionMenu({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const MENU_WIDTH = 120;
  const MENU_GAP = 4;

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const left = Math.min(
      Math.max(4, rect.right - MENU_WIDTH),
      window.innerWidth - MENU_WIDTH - 4,
    );
    setPos({ top: rect.bottom + MENU_GAP, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const scrollHandler = () => setOpen(false);
    document.addEventListener('mousedown', handler);
    window.addEventListener('scroll', scrollHandler, true);
    window.addEventListener('resize', scrollHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', scrollHandler, true);
      window.removeEventListener('resize', scrollHandler);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((prev) => !prev); }}
        className="flex h-6 w-6 items-center justify-center rounded-lg transition-colors hover:bg-[#f0f0ec]"
        style={{ color: '#b0b5bc' }}
        aria-label="更多操作"
        title="更多操作"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="12" cy="19" r="1.5" />
        </svg>
      </button>
      {open && pos ? createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 overflow-hidden rounded-lg py-1 shadow-lg"
          style={{
            top: pos.top,
            left: pos.left,
            width: MENU_WIDTH,
            background: S.card,
            border: `1px solid ${S.border}`,
          }}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onEdit(); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] transition-colors hover:bg-[#f5f3ef]"
            style={{ color: S.text }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
            编辑
          </button>
          {onDelete ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setOpen(false); onDelete(); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] transition-colors hover:bg-[#fef2f2]"
              style={{ color: '#dc2626' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 6h18" /><path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v6" /><path d="M14 11v6" />
              </svg>
              删除
            </button>
          ) : null}
        </div>,
        document.body,
      ) : null}
    </>
  );
}
