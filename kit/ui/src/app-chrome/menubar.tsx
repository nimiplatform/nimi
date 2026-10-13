import React, { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { NimiAppCommandState, NimiAppMenu } from '@nimiplatform/kit/core/app-commands';
import { Button } from '../components/button.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/popover.js';

export type NimiMenubarCommand = { readonly id: string; readonly label: string; readonly menu: NimiAppMenu; readonly shortcut?: string; readonly state: NimiAppCommandState };
const menus: readonly NimiAppMenu[] = ['file', 'edit', 'view', 'help'];
const menuLabels = { en: { file: 'File', edit: 'Edit', view: 'View', help: 'Help', all: 'Menu' }, zh: { file: '文件', edit: '编辑', view: '视图', help: '帮助', all: '菜单' } };
const panelClass = 'nimi-menubar__panel max-h-[calc(100vh-var(--nimi-space-10))] max-w-[calc(100vw-var(--nimi-space-5))] overflow-y-auto [-webkit-app-region:no-drag]';
const itemClass = 'nimi-menubar__item flex min-h-[var(--nimi-sizing-action-sm-height)] w-full items-center gap-[var(--nimi-space-3)] rounded-[var(--nimi-radius-sm)] px-[var(--nimi-space-4)] py-[var(--nimi-space-2)] text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-text-secondary)] outline-none hover:bg-[var(--nimi-action-ghost-hover)] focus-visible:bg-[var(--nimi-action-ghost-hover)] focus-visible:ring-1 focus-visible:ring-[var(--nimi-border-focus)] disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]';

// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-app-chrome
export function NimiMenubar({ commands, locale, compact, onExecute, onCaptureSelection, onRestoreEditFocus }: {
  readonly commands: readonly NimiMenubarCommand[]; readonly locale: 'en' | 'zh'; readonly compact: boolean;
  readonly onExecute: (id: string) => void; readonly onCaptureSelection: () => void;
  readonly onRestoreEditFocus: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [submenu, setSubmenu] = useState<NimiAppMenu | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const editedRef = useRef(false);
  const enterFromEnd = useRef(false);
  const branchRefs = useRef<Partial<Record<NimiAppMenu, HTMLButtonElement | null>>>({});
  const id = useId();
  const tops = compact ? ['all'] : menus.filter(menu => commands.some(c => c.menu === menu && c.state.visible));
  const focusTop = (index: number) => {
    const normalized = (index + tops.length) % tops.length;
    setActive(normalized);
    rootRef.current?.querySelectorAll<HTMLButtonElement>('[data-nimi-menu-trigger]')[normalized]?.focus();
  };
  const select = (command: NimiMenubarCommand) => {
    if (!command.state.enabled || command.state.busy) return;
    editedRef.current = command.id.startsWith('nimi.edit.');
    setSubmenu(null); setOpen(null); onExecute(command.id);
  };
  const focusMenu = (name: string) => {
    const items = [...(menuRefs.current[name]?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)') ?? [])];
    (enterFromEnd.current ? items[items.length - 1] : items[0])?.focus(); enterFromEnd.current = false;
  };
  const restoreFocus = (event: Event) => {
    if (editedRef.current) { event.preventDefault(); onRestoreEditFocus(); }
  };
  const commandItem = (command: NimiMenubarCommand) => <button key={command.id} type="button" role={command.state.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
    data-nimi-command-id={command.id} aria-checked={command.state.checked} disabled={!command.state.enabled || command.state.busy} tabIndex={-1}
    className={itemClass} title={command.state.reason} onClick={() => select(command)}>
    <span aria-hidden="true" className="w-4">{command.state.checked ? '✓' : ''}</span>
    <span className="flex-1">{command.label}</span><span className="text-[var(--nimi-text-muted)]">{command.shortcut}</span>
  </button>;
  const keyMenu = (event: KeyboardEvent<HTMLDivElement>, name: string) => {
    if (event.key === 'Tab') { setSubmenu(null); setOpen(null); return; }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const items = [...(menuRefs.current[name]?.querySelectorAll<HTMLButtonElement>('[role="menuitem"], [role="menuitemcheckbox"]') ?? [])].filter(button => !button.disabled);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[index]?.focus();
    } else if (!compact && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      const next = (tops.indexOf(name) + (event.key === 'ArrowRight' ? 1 : -1) + tops.length) % tops.length;
      setActive(next); setOpen(tops[next]!);
    } else if (event.key === 'Escape') { event.preventDefault(); setOpen(null); focusTop(tops.indexOf(name)); }
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const match = [...items.slice(current + 1), ...items.slice(0, current + 1)].find(button => button.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()));
      if (match) { event.preventDefault(); match.focus(); }
    }
  };
  return <div ref={rootRef} className="nimi-menubar flex items-center gap-[var(--nimi-space-1)] [-webkit-app-region:no-drag]" role="menubar" aria-label={locale === 'zh' ? '应用菜单' : 'Application menu'}>
    {tops.map((name, index) => {
      const visible = commands.filter(c => c.state.visible && (name === 'all' || c.menu === name))
        .sort((a, b) => menus.indexOf(a.menu) - menus.indexOf(b.menu));
      return <Popover key={name} open={open === name} onOpenChange={next => { if (next) { editedRef.current = false; onCaptureSelection(); } else setSubmenu(null); setOpen(next ? name : null); }}>
        <PopoverTrigger asChild>
          <Button tone="ghost" size="sm" role="menuitem" data-nimi-menu-trigger="true" tabIndex={active === index ? 0 : -1}
            aria-haspopup="menu" aria-expanded={open === name} aria-controls={`${id}-${name}`} onFocus={() => setActive(index)}
            onPointerDownCapture={onCaptureSelection}
            onKeyDown={event => {
              if (event.key === 'Tab') { setSubmenu(null); setOpen(null); return; }
              if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); focusTop(index + (event.key === 'ArrowRight' ? 1 : -1)); }
              else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); enterFromEnd.current = event.key === 'ArrowUp'; editedRef.current = false; onCaptureSelection(); setOpen(name); }
              else if (event.key === 'Escape') { setOpen(null); }
            }}>
            {menuLabels[locale][name as keyof typeof menuLabels.en]}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className={panelClass} onOpenAutoFocus={event => {
          event.preventDefault(); queueMicrotask(() => focusMenu(name));
        }} onCloseAutoFocus={restoreFocus} onInteractOutside={event => {
          if (event.target instanceof Element && event.target.closest(`[data-nimi-menubar-owner="${id}"]`)) event.preventDefault();
        }}>
          <div id={`${id}-${name}`} data-nimi-menubar-owner={id} ref={element => { menuRefs.current[name] = element; }} role="menu" aria-label={menuLabels[locale][name as keyof typeof menuLabels.en]} onKeyDown={event => keyMenu(event, name)}>
            {compact ? menus.filter(menu => visible.some(command => command.menu === menu)).map(menu => <Popover key={menu} open={submenu === menu} onOpenChange={next => setSubmenu(next ? menu : null)}>
              <PopoverTrigger asChild><button ref={element => { branchRefs.current[menu] = element; }} type="button" role="menuitem" aria-label={menuLabels[locale][menu]} tabIndex={-1} className={itemClass} aria-haspopup="menu" aria-expanded={submenu === menu}
                disabled={!visible.some(command => command.menu === menu && command.state.enabled && !command.state.busy)}
                onKeyDown={event => { if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return; if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); setSubmenu(menu); } }}>
                <span className="flex-1">{menuLabels[locale][menu]}</span><span aria-hidden="true">›</span>
              </button></PopoverTrigger>
              <PopoverContent side="right" align="start" className={panelClass} onOpenAutoFocus={event => { event.preventDefault(); queueMicrotask(() => focusMenu(`branch-${menu}`)); }} onCloseAutoFocus={restoreFocus}>
                <div data-nimi-menubar-owner={id} ref={element => { menuRefs.current[`branch-${menu}`] = element; }} role="menu" aria-label={menuLabels[locale][menu]} onKeyDown={event => {
                  if (event.key === 'Tab') { event.stopPropagation(); keyMenu(event, `branch-${menu}`); return; }
                  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
                  event.stopPropagation();
                  if (event.key === 'ArrowLeft' || event.key === 'Escape') { event.preventDefault(); setSubmenu(null); branchRefs.current[menu]?.focus(); }
                  else keyMenu(event, `branch-${menu}`);
                }}>{visible.filter(command => command.menu === menu).map(commandItem)}</div>
              </PopoverContent>
            </Popover>) : visible.map(commandItem)}
          </div>
        </PopoverContent>
      </Popover>;
    })}
  </div>;
}
