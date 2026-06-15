import { useState, type ChangeEvent } from 'react';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  NimiTabs,
  NumberStepper,
  OverlayShell,
  PillTabs,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SegmentedControl,
  Slider,
  Toggle,
  Tooltip,
  TooltipProvider,
} from '@nimiplatform/kit/ui';
import { SlidersHorizontal } from 'lucide-react';

// ---- Interactive demo wrappers ----

export function ToggleDemo() {
  const [on, setOn] = useState(true);
  return <Toggle checked={on} onChange={setOn} />;
}
export function CheckboxDemo() {
  const [on, setOn] = useState(true);
  return <Checkbox checked={on} onChange={(event: ChangeEvent<HTMLInputElement>) => setOn(event.currentTarget.checked)} label="Fail closed on missing SDK" />;
}
export function SliderDemo() {
  const [value, setValue] = useState(62);
  return <Slider min={1} max={100} value={value} onChange={(event: ChangeEvent<HTMLInputElement>) => setValue(Number(event.currentTarget.value))} showValue aria-label="Batch size" />;
}
export function SegmentedDemo() {
  const [value, setValue] = useState('single');
  return (
    <SegmentedControl
      items={[{ value: 'single', label: 'Single' }, { value: 'stream', label: 'Stream' }, { value: 'batch', label: 'Batch' }]}
      value={value}
      onValueChange={setValue}
      ariaLabel="Run mode"
      size="sm"
    />
  );
}
export function NumberStepperDemo() {
  const [value, setValue] = useState(4);
  return <NumberStepper value={value} onValueChange={setValue} min={1} max={16} ariaLabel="Batch count" />;
}
export function TabsDemo() {
  const [value, setValue] = useState('overview');
  return (
    <NimiTabs
      items={[{ value: 'overview', label: 'Overview' }, { value: 'props', label: 'Props' }, { value: 'tokens', label: 'Tokens' }]}
      value={value}
      onValueChange={setValue}
      ariaLabel="Recipe view"
    />
  );
}
export function PillTabsDemo() {
  const [value, setValue] = useState('live');
  return (
    <PillTabs
      items={[{ value: 'live', label: 'Live' }, { value: 'code', label: 'Code' }, { value: 'a11y', label: 'A11y' }]}
      value={value}
      onValueChange={setValue}
      ariaLabel="Preview mode"
    />
  );
}
export function DialogDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button tone="secondary" size="sm" onClick={() => setOpen(true)}>Open dialog</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onClose={() => setOpen(false)}>
          <DialogHeader>Apply AIProfile</DialogHeader>
          <DialogBody>Review the NimiAIConfig diff before applying it to this capability.</DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
export function OverlayShellDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button tone="secondary" size="sm" onClick={() => setOpen(true)}>Open drawer</Button>
      <OverlayShell
        open={open}
        kind="drawer"
        size="M"
        title="SDK projection detail"
        footer={<Button tone="primary" size="sm" onClick={() => setOpen(false)}>Done</Button>}
        onClose={() => setOpen(false)}
      >
        <div className="kit-pop">
          <strong>Consumer-owned content</strong>
          <span>Overlay chrome comes from Kit UI.</span>
        </div>
      </OverlayShell>
    </>
  );
}
export function PopoverDemo() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button tone="secondary" size="sm" leadingIcon={<SlidersHorizontal size={13} />}>Open popover</Button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="kit-pop">
          <strong>Route detail</strong>
          <span>Local runtime · text.generate</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
export function TooltipDemo() {
  return (
    <TooltipProvider>
      <Tooltip content="Runs through the admitted SDK surface">
        <Button tone="ghost" size="sm">Hover for tooltip</Button>
      </Tooltip>
    </TooltipProvider>
  );
}
export function ConfirmDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button tone="danger" size="sm" onClick={() => setOpen(true)}>Delete draft…</Button>
      <ConfirmDialog
        open={open}
        title="Delete prompt draft?"
        message="This removes the local draft for this capability. It cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => setOpen(false)}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
