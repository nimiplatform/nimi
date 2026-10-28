import { Button, Popover, PopoverContent, PopoverTrigger, SidebarShell } from '@nimiplatform/kit/ui';
import { ChevronDown, PanelLeft } from 'lucide-react';
import { useEffect, useImperativeHandle, useState, type ReactNode, type Ref, type RefObject } from 'react';

const COMPACT_QUERY = '(max-width: 767px)';

export type DesktopModuleSidebarHandle = { focusSearch: () => void };

/** Home module navigation: shared rail geometry and one compact-window entry. */
export function DesktopModuleSidebar({
  children,
  label,
  selectionKey,
  searchInputRef,
  ref,
  'data-testid': testId,
}: {
  children: ReactNode;
  label: string;
  selectionKey?: string | null;
  searchInputRef?: RefObject<HTMLInputElement | null>;
  ref?: Ref<DesktopModuleSidebarHandle>;
  'data-testid'?: string;
}) {
  const [compact, setCompact] = useState(() => globalThis.window?.matchMedia?.(COMPACT_QUERY).matches ?? false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const media = window.matchMedia?.(COMPACT_QUERY);
    if (!media) return;
    const update = () => { setCompact(media.matches); setOpen(false); };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => { setOpen(false); }, [selectionKey]);
  useImperativeHandle(ref, () => ({
    focusSearch() {
      if (compact) setOpen(true);
      searchInputRef?.current?.focus();
      searchInputRef?.current?.select();
    },
  }), [compact, searchInputRef]);

  const sidebar = (
    <SidebarShell className="desktop-sidebar desktop-module-sidebar" aria-label={label} data-testid={testId}>
      {children}
    </SidebarShell>
  );
  if (!compact) return sidebar;
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button tone="secondary" size="sm" className="desktop-module-sidebar-trigger justify-start" aria-label={label}>
          <PanelLeft size={16} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="nimi-ui-module--desktop desktop-module-sidebar-popover p-0"
        onOpenAutoFocus={searchInputRef ? (event) => {
          event.preventDefault();
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        } : undefined}
      >
        {sidebar}
      </PopoverContent>
    </Popover>
  );
}
