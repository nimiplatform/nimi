import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { ActionMenu, IconButton, Popover, PopoverContent, PopoverTrigger, type NimiMenuItem } from '@nimiplatform/kit/ui';

/** Social action composition; Kit owns the menu, focus and overlay behavior. */
export function RelationshipActionsMenu({ label, items, disabled = false }: {
  label: string; items: NimiMenuItem[]; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <IconButton tone="ghost" size="sm" icon={<MoreHorizontal size={18} />} aria-label={label} title={label} disabled={disabled} />
    </PopoverTrigger>
    <PopoverContent align="end" sideOffset={6} className="p-1">
      <ActionMenu items={items} ariaLabel={label} onRequestClose={() => setOpen(false)} />
    </PopoverContent>
  </Popover>;
}
