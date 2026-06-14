import type { ReactNode } from 'react';
import {
  Avatar,
  AppCardSurface,
  Button,
  CompactAction,
  EmptyState,
  FieldShell,
  FieldTrigger,
  IconButton,
  IconToggleAction,
  InlineAlert,
  LoadingSkeleton,
  ProgressIndicator,
  ScrollArea,
  ScrollShell,
  SelectField,
  StatusBadge,
  Surface,
  TextareaField,
  TextField,
  Timeline,
  TimelineGroup,
} from '@nimiplatform/kit/ui';
import { Boxes, Check, RefreshCw, Search, Sparkles } from 'lucide-react';
import {
  CheckboxDemo,
  ConfirmDemo,
  DialogDemo,
  NumberStepperDemo,
  OverlayShellDemo,
  PillTabsDemo,
  PopoverDemo,
  SegmentedDemo,
  SliderDemo,
  TabsDemo,
  ToggleDemo,
  TooltipDemo,
} from './kit-component-gallery-demos.js';

// UI Recipes — an industrial Nimi Kit component library for third-party Nimi App
// developers. Two panes: an ontology/coverage taxonomy (left) and a live
// workbench canvas with inline recipe evidence (right). It performs NO runtime
// work — this is component documentation, rendered from the canonical kit surface.

export type CategoryId =
  | 'foundations'
  | 'actions'
  | 'inputs'
  | 'selection'
  | 'overlays'
  | 'layouts'
  | 'data';

export type Category = { id: CategoryId; symbol: string; label: string; desc: string };

export const CATEGORIES: Category[] = [
  { id: 'foundations', symbol: 'F', label: 'Foundations', desc: 'Color, type, radius, elevation' },
  { id: 'actions', symbol: 'A', label: 'Actions', desc: 'Button, IconButton, menus' },
  { id: 'inputs', symbol: 'I', label: 'Inputs', desc: 'Text, search, textarea, select' },
  { id: 'selection', symbol: 'S', label: 'Selection', desc: 'Toggle, checkbox, segmented, slider' },
  { id: 'overlays', symbol: 'O', label: 'Overlays', desc: 'Dialog, popover, tooltip, confirm' },
  { id: 'layouts', symbol: 'L', label: 'Layouts', desc: 'Tabs, scroll, surface materials' },
  { id: 'data', symbol: 'D', label: 'Data & Status', desc: 'Badge, alert, timeline, avatar' },
];

// ---- Foundations data ----

export const COLOR_TOKENS: Array<{ token: string; label: string; onDark?: boolean }> = [
  { token: '--nimi-action-primary-bg', label: 'Action primary', onDark: true },
  { token: '--nimi-text-primary', label: 'Text primary', onDark: true },
  { token: '--nimi-text-secondary', label: 'Text secondary' },
  { token: '--nimi-surface-canvas', label: 'Surface canvas' },
  { token: '--nimi-surface-card', label: 'Surface card' },
  { token: '--nimi-border-subtle', label: 'Border subtle' },
  { token: '--nimi-status-info-soft-bg', label: 'Status info' },
  { token: '--nimi-status-danger-soft-bg', label: 'Status danger' },
];

export const TYPE_ROLES: Array<{ role: string; sample: string; className: string }> = [
  { role: 'page-title', sample: 'Page title', className: 'kit-type-page' },
  { role: 'section-title', sample: 'Section title', className: 'kit-type-section' },
  { role: 'card-title', sample: 'Card title', className: 'kit-type-card' },
  { role: 'body', sample: 'Body copy for product surfaces and settings flows.', className: 'kit-type-body' },
  { role: 'helper', sample: 'Helper text under form controls.', className: 'kit-type-helper' },
  { role: 'label', sample: 'Field label', className: 'kit-type-label' },
];

export const SCALE_TOKENS: Array<{ token: string; label: string }> = [
  { token: '--nimi-radius-sm', label: 'Radius sm' },
  { token: '--nimi-radius-md', label: 'Radius md' },
  { token: '--nimi-radius-lg', label: 'Radius lg' },
];


// ---- Recipe registry ----

export type Recipe = {
  id: string;
  category: CategoryId;
  name: string;
  exportsLabel: string;
  importNames: string[];
  extraImports?: string[];
  badge: { label: string; tone: 'success' | 'info' | 'warning' | 'neutral' };
  wide?: boolean;
  stage: ReactNode;
  snippet: string;
  props: Array<{ name: string; desc: string }>;
};

type RecipeMode = 'live' | 'code' | 'props' | 'a11y' | 'tokens';

const RECIPE_MODES: Array<{ id: RecipeMode; label: string }> = [
  { id: 'live', label: 'Live' },
  { id: 'code', label: 'Code' },
  { id: 'props', label: 'Props' },
  { id: 'a11y', label: 'A11y' },
  { id: 'tokens', label: 'Tokens' },
];

export const RECIPES: Recipe[] = [
  // Actions
  {
    id: 'button',
    category: 'actions',
    name: 'Button · IconButton',
    exportsLabel: 'Button, IconButton',
    importNames: ['Button', 'IconButton'],
    extraImports: ["import { RefreshCw, Sparkles } from 'lucide-react';"],
    badge: { label: 'live', tone: 'success' },
    stage: (
      <>
        <Button tone="primary" leadingIcon={<Sparkles size={14} />}>Primary</Button>
        <Button tone="secondary">Secondary</Button>
        <Button tone="ghost">Ghost</Button>
        <Button tone="danger">Danger</Button>
        <IconButton aria-label="Refresh" tone="secondary" icon={<RefreshCw size={15} />} />
      </>
    ),
    snippet: `<div className="flex flex-wrap items-center gap-3">
  <Button tone="primary" leadingIcon={<Sparkles size={14} />}>Primary</Button>
  <Button tone="secondary">Secondary</Button>
  <Button tone="ghost">Ghost</Button>
  <Button tone="danger">Danger</Button>
  <IconButton aria-label="Refresh" tone="secondary" icon={<RefreshCw size={15} />} />
</div>`,
    props: [
      { name: 'tone', desc: 'primary | secondary | ghost | danger' },
      { name: 'size', desc: 'sm | md | lg' },
      { name: 'loading', desc: 'disables the action and shows a spinner' },
      { name: 'leadingIcon', desc: 'ReactNode rendered before the label' },
    ],
  },
  {
    id: 'app-actions',
    category: 'actions',
    name: 'App surface actions',
    exportsLabel: 'AppCardSurface, CompactAction, IconToggleAction, FieldTrigger, ScrollShell',
    importNames: ['AppCardSurface', 'CompactAction', 'IconToggleAction', 'FieldTrigger', 'ScrollShell'],
    extraImports: ["import { Check } from 'lucide-react';"],
    badge: { label: 'app shell', tone: 'success' },
    wide: true,
    stage: (
      <AppCardSurface kind="promoted-glass" className="kit-surface-sample">
        <div className="flex flex-wrap items-center gap-2">
          <CompactAction tone="primary">Apply</CompactAction>
          <CompactAction tone="danger">Reset</CompactAction>
          <IconToggleAction aria-label="Pin panel" icon={<Check size={14} />} active />
        </div>
        <FieldTrigger className="mt-3">Runtime route · text.generate</FieldTrigger>
        <ScrollShell className="mt-3 max-h-16 text-xs text-[var(--nimi-text-secondary)]">
          Shared app surfaces stay in Kit so Desktop, Tester, and future apps consume the same primitive.
        </ScrollShell>
      </AppCardSurface>
    ),
    snippet: `<AppCardSurface kind="promoted-glass" className="kit-surface-sample">
  <div className="flex flex-wrap items-center gap-2">
    <CompactAction tone="primary">Apply</CompactAction>
    <CompactAction tone="danger">Reset</CompactAction>
    <IconToggleAction aria-label="Pin panel" icon={<Check size={14} />} active />
  </div>
  <FieldTrigger className="mt-3">Runtime route · text.generate</FieldTrigger>
  <ScrollShell className="mt-3 max-h-16 text-xs text-[var(--nimi-text-secondary)]">
    Shared app surfaces stay in Kit so Desktop, Tester, and future apps consume the same primitive.
  </ScrollShell>
</AppCardSurface>`,
    props: [
      { name: 'kind', desc: 'promoted-glass | operational-solid app surface recipe' },
      { name: 'tone', desc: 'neutral | primary | danger compact action tone' },
      { name: 'activeTone', desc: 'primary | danger icon toggle active state' },
    ],
  },
  // Inputs
  {
    id: 'fields',
    category: 'inputs',
    name: 'Field system',
    exportsLabel: 'FieldShell, TextField, SelectField',
    importNames: ['FieldShell', 'TextField', 'SearchField', 'SelectField', 'TextareaField'],
    extraImports: ["import { Search } from 'lucide-react';"],
    badge: { label: 'forms', tone: 'info' },
    wide: true,
    stage: (
      <>
        <FieldShell label="App identity"><TextField defaultValue="nimi.tester" leading={<Search size={14} />} /></FieldShell>
        <FieldShell label="Capability route">
          <SelectField
            defaultValue="text.generate"
            options={[
              { value: 'text.generate', label: 'Text generation' },
              { value: 'chat.stream', label: 'Chat stream' },
              { value: 'image.generate', label: 'Image generation' },
            ]}
            aria-label="Capability route"
          />
        </FieldShell>
      </>
    ),
    snippet: `<>
  <FieldShell label="App identity">
    <TextField defaultValue="nimi.tester" leading={<Search size={14} />} />
  </FieldShell>
  <FieldShell label="Capability route">
    <SelectField
      defaultValue="text.generate"
      options={[
        { value: 'text.generate', label: 'Text generation' },
        { value: 'chat.stream', label: 'Chat stream' },
        { value: 'image.generate', label: 'Image generation' },
      ]}
      aria-label="Capability route"
    />
  </FieldShell>
</>`,
    props: [
      { name: 'label', desc: 'FieldShell heading + association' },
      { name: 'options', desc: 'closed set of { value, label } for SelectField' },
      { name: 'leading', desc: 'icon node inside TextField' },
      { name: 'rows', desc: 'TextareaField initial height' },
    ],
  },
  {
    id: 'textarea',
    category: 'inputs',
    name: 'TextareaField',
    exportsLabel: 'TextareaField',
    importNames: ['TextareaField'],
    badge: { label: 'forms', tone: 'info' },
    stage: <TextareaField rows={3} defaultValue="Write a concise acceptance note for a runtime-backed Nimi App." />,
    snippet: `<TextareaField
  rows={3}
  defaultValue="Write a concise acceptance note for a runtime-backed Nimi App."
/>`,
    props: [
      { name: 'rows', desc: 'initial visible rows' },
      { name: 'wrap', desc: 'soft | hard text wrapping' },
    ],
  },
  {
    id: 'numeric',
    category: 'inputs',
    name: 'Slider · NumberStepper',
    exportsLabel: 'Slider, NumberStepper',
    importNames: ['Slider', 'NumberStepper'],
    extraImports: ["import { useState } from 'react';"],
    badge: { label: 'numeric', tone: 'info' },
    stage: (
      <>
        <SliderDemo />
        <NumberStepperDemo />
      </>
    ),
    snippet: `function NumericControls() {
  const [sliderValue, setSliderValue] = useState(62);
  const [stepperValue, setStepperValue] = useState(4);

  return (
    <>
      <Slider
        min={1}
        max={100}
        value={sliderValue}
        onChange={(event) => setSliderValue(Number(event.currentTarget.value))}
        showValue
        aria-label="Batch size"
      />
      <NumberStepper
        value={stepperValue}
        onValueChange={setStepperValue}
        min={1}
        max={16}
        ariaLabel="Batch count"
      />
    </>
  );
}`,
    props: [
      { name: 'min / max', desc: 'numeric bounds' },
      { name: 'value', desc: 'controlled current value' },
      { name: 'onValueChange', desc: 'NumberStepper change callback' },
    ],
  },
  // Selection
  {
    id: 'selection',
    category: 'selection',
    name: 'Selection controls',
    exportsLabel: 'Toggle, Checkbox, SegmentedControl',
    importNames: ['Toggle', 'Checkbox', 'SegmentedControl'],
    extraImports: ["import { useState } from 'react';"],
    badge: { label: 'state', tone: 'info' },
    wide: true,
    stage: (
      <>
        <ToggleDemo />
        <CheckboxDemo />
        <SegmentedDemo />
      </>
    ),
    snippet: `function SelectionControls() {
  const [toggleOn, setToggleOn] = useState(true);
  const [checked, setChecked] = useState(true);
  const [mode, setMode] = useState('single');

  return (
    <>
      <Toggle checked={toggleOn} onChange={setToggleOn} />
      <Checkbox
        checked={checked}
        onChange={(event) => setChecked(event.currentTarget.checked)}
        label="Fail closed on missing SDK"
      />
      <SegmentedControl
        items={[
          { value: 'single', label: 'Single' },
          { value: 'stream', label: 'Stream' },
          { value: 'batch', label: 'Batch' },
        ]}
        value={mode}
        onValueChange={setMode}
        ariaLabel="Run mode"
        size="sm"
      />
    </>
  );
}`,
    props: [
      { name: 'checked', desc: 'Toggle / Checkbox controlled state' },
      { name: 'items', desc: 'SegmentedControl { value, label }[]' },
      { name: 'onValueChange', desc: 'segment selection callback' },
    ],
  },
  // Overlays
  {
    id: 'dialog',
    category: 'overlays',
    name: 'Dialog',
    exportsLabel: 'Dialog, DialogContent, Button',
    importNames: ['Dialog', 'DialogContent', 'DialogHeader', 'DialogBody', 'Button'],
    badge: { label: 'interactive', tone: 'info' },
    stage: <DialogDemo />,
    extraImports: ["import { useState } from 'react';"],
    snippet: `function DialogRecipe() {
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
}`,
    props: [
      { name: 'open', desc: 'controlled open state' },
      { name: 'onOpenChange', desc: 'open/close callback' },
      { name: 'onClose', desc: 'DialogContent dismiss handler' },
    ],
  },
  {
    id: 'overlay-shell',
    category: 'overlays',
    name: 'OverlayShell',
    exportsLabel: 'OverlayShell, Button',
    importNames: ['OverlayShell', 'Button'],
    badge: { label: 'interactive', tone: 'info' },
    stage: <OverlayShellDemo />,
    extraImports: ["import { useState } from 'react';"],
    snippet: `function OverlayShellRecipe() {
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
}`,
    props: [
      { name: 'kind', desc: 'dialog | drawer | popover shell chrome' },
      { name: 'size', desc: 'admitted drawer width token' },
      { name: 'title / footer', desc: 'consumer-supplied overlay slots' },
    ],
  },
  {
    id: 'popover',
    category: 'overlays',
    name: 'Popover',
    exportsLabel: 'Popover, PopoverContent, Button',
    importNames: ['Popover', 'PopoverTrigger', 'PopoverContent', 'Button'],
    badge: { label: 'interactive', tone: 'info' },
    stage: <PopoverDemo />,
    extraImports: ["import { SlidersHorizontal } from 'lucide-react';"],
    snippet: `<Popover>
  <PopoverTrigger asChild>
    <Button tone="secondary" size="sm" leadingIcon={<SlidersHorizontal size={13} />}>
      Open popover
    </Button>
  </PopoverTrigger>
  <PopoverContent>
    <div className="kit-pop">
      <strong>Route detail</strong>
      <span>Local runtime · text.generate</span>
    </div>
  </PopoverContent>
</Popover>`,
    props: [
      { name: 'PopoverTrigger', desc: 'asChild wraps your own button' },
      { name: 'PopoverContent', desc: 'floating surface content' },
    ],
  },
  {
    id: 'tooltip',
    category: 'overlays',
    name: 'Tooltip',
    exportsLabel: 'Tooltip, TooltipProvider, Button',
    importNames: ['Tooltip', 'TooltipProvider', 'Button'],
    badge: { label: 'interactive', tone: 'info' },
    stage: <TooltipDemo />,
    snippet: `<TooltipProvider>
  <Tooltip content="Runs through the admitted SDK surface">
    <Button tone="ghost" size="sm">Hover for tooltip</Button>
  </Tooltip>
</TooltipProvider>`,
    props: [
      { name: 'content', desc: 'tooltip body node' },
      { name: 'placement', desc: 'top | bottom side' },
    ],
  },
  {
    id: 'confirm',
    category: 'overlays',
    name: 'ConfirmDialog',
    exportsLabel: 'ConfirmDialog, Button',
    importNames: ['ConfirmDialog', 'Button'],
    badge: { label: 'interactive', tone: 'warning' },
    stage: <ConfirmDemo />,
    extraImports: ["import { useState } from 'react';"],
    snippet: `function ConfirmDialogRecipe() {
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
}`,
    props: [
      { name: 'title / message', desc: 'confirmation copy' },
      { name: 'confirmTone', desc: 'danger | primary' },
      { name: 'onConfirm', desc: 'committed action callback' },
    ],
  },
  // Layouts
  {
    id: 'tabs',
    category: 'layouts',
    name: 'NimiTabs · PillTabs',
    exportsLabel: 'NimiTabs, PillTabs',
    importNames: ['NimiTabs', 'PillTabs'],
    badge: { label: 'navigation', tone: 'info' },
    wide: true,
    stage: (
      <>
        <TabsDemo />
        <PillTabsDemo />
      </>
    ),
    extraImports: ["import { useState } from 'react';"],
    snippet: `function TabsRecipe() {
  const [tabsValue, setTabsValue] = useState('overview');
  const [pillValue, setPillValue] = useState('live');

  return (
    <>
      <NimiTabs
        items={[
          { value: 'overview', label: 'Overview' },
          { value: 'props', label: 'Props' },
          { value: 'tokens', label: 'Tokens' },
        ]}
        value={tabsValue}
        onValueChange={setTabsValue}
        ariaLabel="Recipe view"
      />
      <PillTabs
        items={[
          { value: 'live', label: 'Live' },
          { value: 'code', label: 'Code' },
          { value: 'a11y', label: 'A11y' },
        ]}
        value={pillValue}
        onValueChange={setPillValue}
        ariaLabel="Preview mode"
      />
    </>
  );
}`,
    props: [
      { name: 'items', desc: '{ value, label }[]' },
      { name: 'value', desc: 'active tab value' },
      { name: 'onValueChange', desc: 'tab change callback' },
    ],
  },
  {
    id: 'scrollarea',
    category: 'layouts',
    name: 'ScrollArea',
    exportsLabel: 'ScrollArea',
    importNames: ['ScrollArea'],
    badge: { label: 'layout', tone: 'neutral' },
    stage: (
      <ScrollArea className="kit-scroll-demo" viewportClassName="kit-scroll-demo__vp">
        <div className="kit-scroll-list">
          {['text.generate', 'chat.stream', 'text.embed', 'image.generate', 'video.generate', 'audio.synthesize'].map((row) => (
            <div key={row} className="kit-scroll-row"><code>{row}</code></div>
          ))}
        </div>
      </ScrollArea>
    ),
    snippet: `<ScrollArea className="kit-scroll-demo" viewportClassName="kit-scroll-demo__vp">
  <div className="kit-scroll-list">
    {[
      'text.generate',
      'chat.stream',
      'text.embed',
      'image.generate',
      'video.generate',
      'audio.synthesize',
    ].map((row) => (
      <div key={row} className="kit-scroll-row"><code>{row}</code></div>
    ))}
  </div>
</ScrollArea>`,
    props: [
      { name: 'viewportClassName', desc: 'styles the scrolling viewport' },
    ],
  },
  {
    id: 'surface',
    category: 'layouts',
    name: 'Surface · glass materials',
    exportsLabel: 'Surface material="glass-*"',
    importNames: ['Surface'],
    badge: { label: 'material', tone: 'success' },
    wide: true,
    stage: (
      <>
        {(['solid', 'glass-thin', 'glass-regular', 'glass-thick', 'glass-chrome'] as const).map((material) => (
          <Surface key={material} material={material} tone="panel" elevation="raised" className="kit-surface-sample">
            <strong>{material}</strong>
          </Surface>
        ))}
      </>
    ),
    snippet: `<>
  {(['solid', 'glass-thin', 'glass-regular', 'glass-thick', 'glass-chrome'] as const).map((material) => (
    <Surface key={material} material={material} tone="panel" elevation="raised" className="kit-surface-sample">
      <strong>{material}</strong>
    </Surface>
  ))}
</>`,
    props: [
      { name: 'material', desc: 'solid | glass-thin | glass-regular | glass-thick | glass-chrome' },
      { name: 'tone', desc: 'canvas | panel | card | hero | overlay' },
      { name: 'elevation', desc: 'base | raised | floating | modal' },
    ],
  },
  // Data & Status
  {
    id: 'status',
    category: 'data',
    name: 'StatusBadge',
    exportsLabel: 'StatusBadge',
    importNames: ['StatusBadge'],
    badge: { label: 'signals', tone: 'success' },
    stage: (
      <>
        <StatusBadge tone="success" shape="dot">ready</StatusBadge>
        <StatusBadge tone="warning" shape="dot">attention</StatusBadge>
        <StatusBadge tone="danger" shape="dot">blocked</StatusBadge>
        <StatusBadge tone="info" shape="soft">info</StatusBadge>
        <StatusBadge tone="neutral" shape="outline">neutral</StatusBadge>
      </>
    ),
    snippet: `<>
  <StatusBadge tone="success" shape="dot">ready</StatusBadge>
  <StatusBadge tone="warning" shape="dot">attention</StatusBadge>
  <StatusBadge tone="danger" shape="dot">blocked</StatusBadge>
  <StatusBadge tone="info" shape="soft">info</StatusBadge>
  <StatusBadge tone="neutral" shape="outline">neutral</StatusBadge>
</>`,
    props: [
      { name: 'tone', desc: 'neutral | success | warning | danger | info' },
      { name: 'shape', desc: 'soft | outline | dot' },
    ],
  },
  {
    id: 'alert',
    category: 'data',
    name: 'InlineAlert',
    exportsLabel: 'InlineAlert',
    importNames: ['InlineAlert'],
    badge: { label: 'signals', tone: 'warning' },
    wide: true,
    stage: (
      <div className="kit-stack">
        <InlineAlert tone="info">Runtime session is ready for this capability.</InlineAlert>
        <InlineAlert tone="warning">Bind a model before running this lane.</InlineAlert>
      </div>
    ),
    snippet: `<div className="kit-stack">
  <InlineAlert tone="info">Runtime session is ready for this capability.</InlineAlert>
  <InlineAlert tone="warning">Bind a model before running this lane.</InlineAlert>
</div>`,
    props: [
      { name: 'tone', desc: 'neutral | success | warning | danger | info' },
      { name: 'icon', desc: 'optional leading icon node' },
    ],
  },
  {
    id: 'progress',
    category: 'data',
    name: 'Progress · Skeleton',
    exportsLabel: 'ProgressIndicator, LoadingSkeleton',
    importNames: ['ProgressIndicator', 'LoadingSkeleton'],
    badge: { label: 'loading', tone: 'info' },
    stage: (
      <div className="kit-stack" style={{ width: '100%' }}>
        <ProgressIndicator value={72} showValue />
        <LoadingSkeleton lines={3} />
      </div>
    ),
    snippet: `<div className="kit-stack" style={{ width: '100%' }}>
  <ProgressIndicator value={72} showValue />
  <LoadingSkeleton lines={3} />
</div>`,
    props: [
      { name: 'value', desc: '0–100 progress percentage' },
      { name: 'lines', desc: 'LoadingSkeleton row count' },
    ],
  },
  {
    id: 'avatar',
    category: 'data',
    name: 'Avatar',
    exportsLabel: 'Avatar',
    importNames: ['Avatar'],
    badge: { label: 'identity', tone: 'neutral' },
    stage: (
      <>
        <Avatar alt="Nimi" fallback="N" />
        <Avatar alt="Tester" fallback="T" shape="rounded" tone="accent" />
        <Avatar alt="Agent" fallback="A" size="lg" />
      </>
    ),
    snippet: `<>
  <Avatar alt="Nimi" fallback="N" />
  <Avatar alt="Tester" fallback="T" shape="rounded" tone="accent" />
  <Avatar alt="Agent" fallback="A" size="lg" />
</>`,
    props: [
      { name: 'src / alt', desc: 'image + accessible name' },
      { name: 'shape', desc: 'circle | rounded | square' },
      { name: 'size', desc: 'sm | md | lg' },
    ],
  },
  {
    id: 'empty',
    category: 'data',
    name: 'EmptyState',
    exportsLabel: 'EmptyState',
    importNames: ['EmptyState', 'Button'],
    badge: { label: 'empty', tone: 'neutral' },
    wide: true,
    stage: (
      <EmptyState
        icon={<Boxes size={18} />}
        title="No captured artifacts"
        description="Run a real capability or resolve a typed blocker before this list fills."
        action={<Button size="sm" tone="secondary" leadingIcon={<RefreshCw size={13} />}>Refresh</Button>}
      />
    ),
    extraImports: ["import { Boxes, RefreshCw } from 'lucide-react';"],
    snippet: `<EmptyState
  icon={<Boxes size={18} />}
  title="No captured artifacts"
  description="Run a real capability or resolve a typed blocker before this list fills."
  action={
    <Button size="sm" tone="secondary" leadingIcon={<RefreshCw size={13} />}>
      Refresh
    </Button>
  }
/>`,
    props: [
      { name: 'title / description', desc: 'empty-state copy' },
      { name: 'action', desc: 'the action that populates the surface' },
    ],
  },
  {
    id: 'timeline',
    category: 'data',
    name: 'Timeline',
    exportsLabel: 'Timeline, TimelineGroup',
    importNames: ['Timeline', 'TimelineGroup'],
    badge: { label: 'evidence', tone: 'info' },
    wide: true,
    stage: (
      <Timeline>
        <TimelineGroup date="Today" secondaryLabel="21:51">
          <div className="kit-tl-item"><strong>Runtime session ready</strong><span>SDK admission surface available</span></div>
        </TimelineGroup>
        <TimelineGroup date="Earlier" secondaryLabel="21:40" isLast>
          <div className="kit-tl-item"><strong>Capability blocked</strong><span>NimiAIConfig binding required</span></div>
        </TimelineGroup>
      </Timeline>
    ),
    snippet: `<Timeline>
  <TimelineGroup date="Today" secondaryLabel="21:51">
    <div className="kit-tl-item">
      <strong>Runtime session ready</strong>
      <span>SDK admission surface available</span>
    </div>
  </TimelineGroup>
  <TimelineGroup date="Earlier" secondaryLabel="21:40" isLast>
    <div className="kit-tl-item">
      <strong>Capability blocked</strong>
      <span>NimiAIConfig binding required</span>
    </div>
  </TimelineGroup>
</Timeline>`,
    props: [
      { name: 'date', desc: 'TimelineGroup heading' },
      { name: 'secondaryLabel', desc: 'right-aligned meta' },
      { name: 'isLast', desc: 'omit the trailing connector' },
    ],
  },
];

export const CHECKLIST = [
  'Use Nimi Kit primitives before app-local controls.',
  'Show live preview, import path, and props per recipe.',
  'Keep runtime calls out of UI Recipes — this is component documentation.',
];
