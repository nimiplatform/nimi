import type { ReactNode } from 'react';
import {
  AppCardSurface,
  Button,
  CompactAction,
  Breadcrumb,
  FieldShell,
  FieldTrigger,
  IconButton,
  IconToggleAction,
  ScrollArea,
  SelectField,
  Steps,
  Surface,
  TextareaField,
  TextField,
  type TypographyRole,
} from '@nimiplatform/kit/ui';
import { Check, RefreshCw, Search, Sparkles } from 'lucide-react';
import {
  CheckboxDemo,
  ConfirmDemo,
  DialogDemo,
  NumberStepperDemo,
  OverlayShellDemo,
  PaginationDemo,
  PillTabsDemo,
  PopoverDemo,
  SegmentedDemo,
  SliderDemo,
  TabsDemo,
  ToggleDemo,
  TooltipDemo,
} from './kit-component-gallery-demos.js';
import { DATA_RECIPES } from './kit-component-gallery-data-recipes.js';

// UI Recipes - an industrial Nimi Kit component library for a Nimi local app
// developers. Two panes: an ontology/coverage taxonomy (left) and a live
// workbench canvas with inline recipe evidence (right). It performs NO runtime
// work - this is component documentation, rendered from the canonical kit surface.

export type CategoryId =
  | 'foundations'
  | 'actions'
  | 'inputs'
  | 'selection'
  | 'overlays'
  | 'layouts'
  | 'data';

export type Category = { id: CategoryId; symbol: string; label: string };

export const CATEGORIES: Category[] = [
  { id: 'foundations', symbol: 'F', label: 'Foundations' },
  { id: 'actions', symbol: 'A', label: 'Actions' },
  { id: 'inputs', symbol: 'I', label: 'Inputs' },
  { id: 'selection', symbol: 'S', label: 'Selection' },
  { id: 'overlays', symbol: 'O', label: 'Overlays' },
  { id: 'layouts', symbol: 'L', label: 'Layouts' },
  { id: 'data', symbol: 'D', label: 'Data & Status' },
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

export const TYPE_ROLES: Array<{ role: TypographyRole; sample: string }> = [
  { role: 'page-title', sample: 'Page title' },
  { role: 'section-title', sample: 'Section title' },
  { role: 'card-title', sample: 'Card title' },
  { role: 'body', sample: 'Body copy for product surfaces and settings flows.' },
  { role: 'helper', sample: 'Helper text under form controls.' },
  { role: 'label', sample: 'Field label' },
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
  accessChecks?: string[];
  tokenFootprint?: Array<{ token: string; role: string; source: string }>;
};

export const RECIPES: Recipe[] = [
  // Actions
  {
    id: 'button',
    category: 'actions',
    name: 'Button / IconButton',
    exportsLabel: 'Button, IconButton',
    importNames: ['Button', 'IconButton'],
    extraImports: ["import { RefreshCw, Sparkles } from 'lucide-react';"],
    badge: { label: 'preview', tone: 'success' },
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
    accessChecks: [
      'Visible text buttons keep their accessible name from children.',
      'aria-label is required for icon-only actions.',
      'loading sets aria-busy and disables the action while preserving focus treatment.',
    ],
    tokenFootprint: [
      { token: '--nimi-action-primary-bg', role: 'primary action fill', source: 'tables/nimi-ui-tokens.yaml' },
      { token: '--nimi-action-primary-text', role: 'primary action foreground', source: 'tables/nimi-ui-tokens.yaml' },
      { token: '--nimi-focus-ring', role: 'keyboard-visible focus ring', source: 'tables/nimi-ui-tokens.yaml' },
    ],
  },
  {
    id: 'app-actions',
    category: 'actions',
    name: 'App surface actions',
    exportsLabel: 'AppCardSurface, CompactAction, IconToggleAction, FieldTrigger',
    importNames: ['AppCardSurface', 'CompactAction', 'IconToggleAction', 'FieldTrigger'],
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
        <FieldTrigger className="mt-3">Capability · text.generate</FieldTrigger>
      </AppCardSurface>
    ),
    snippet: `<AppCardSurface kind="promoted-glass" className="kit-surface-sample">
  <div className="flex flex-wrap items-center gap-2">
    <CompactAction tone="primary">Apply</CompactAction>
    <CompactAction tone="danger">Reset</CompactAction>
    <IconToggleAction aria-label="Pin panel" icon={<Check size={14} />} active />
  </div>
  <FieldTrigger className="mt-3">Capability · text.generate</FieldTrigger>
</AppCardSurface>`,
    props: [
      { name: 'kind', desc: 'promoted-glass | operational-solid app surface recipe' },
      { name: 'tone', desc: 'neutral | primary | danger compact action tone' },
      { name: 'activeTone', desc: 'primary | danger icon toggle active state' },
    ],
    accessChecks: [
      'CompactAction follows Button keyboard and focus semantics.',
      'IconToggleAction needs aria-label because the icon is decorative.',
      'FieldTrigger text must identify the consumer-owned field or capability.',
    ],
    tokenFootprint: [
      { token: '--nimi-material-glass-thin-bg', role: 'promoted app surface material', source: 'tables/nimi-ui-themes.yaml' },
      { token: '--nimi-action-primary-bg', role: 'primary compact action fill', source: 'tables/nimi-ui-tokens.yaml' },
      { token: '--nimi-border-subtle', role: 'field trigger and surface boundary', source: 'tables/nimi-ui-tokens.yaml' },
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
      <div className="kit-fields-recipe grid w-full min-w-0 max-w-sm gap-3">
        <FieldShell label="App identity">
          <TextField defaultValue="nimi.lab" leading={<Search size={14} />} />
        </FieldShell>
        <FieldShell label="Capability">
          <SelectField
            defaultValue="text.generate"
            options={[
              { value: 'text.generate', label: 'Text generation' },
              { value: 'chat.stream', label: 'Chat stream' },
              { value: 'image.generate', label: 'Image generation' },
            ]}
            aria-label="Capability"
          />
        </FieldShell>
      </div>
    ),
    snippet: `<div className="kit-fields-recipe grid w-full min-w-0 max-w-sm gap-3">
  <FieldShell label="App identity">
    <TextField defaultValue="nimi.lab" leading={<Search size={14} />} />
  </FieldShell>
  <FieldShell label="Capability">
    <SelectField
      defaultValue="text.generate"
      options={[
        { value: 'text.generate', label: 'Text generation' },
        { value: 'chat.stream', label: 'Chat stream' },
        { value: 'image.generate', label: 'Image generation' },
      ]}
      aria-label="Capability"
    />
  </FieldShell>
</div>`,
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
    name: 'Slider / NumberStepper',
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
      <div className="kit-selection-recipe grid w-full min-w-0 max-w-md gap-3 justify-items-start">
        <ToggleDemo />
        <CheckboxDemo />
        <SegmentedDemo />
      </div>
    ),
    snippet: `function SelectionControls() {
  const [toggleOn, setToggleOn] = useState(true);
  const [checked, setChecked] = useState(true);
  const [mode, setMode] = useState('single');

  return (
    <div className="kit-selection-recipe grid w-full min-w-0 max-w-md gap-3 justify-items-start">
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
    </div>
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
    importNames: ['Dialog', 'DialogContent', 'DialogHeader', 'DialogTitle', 'DialogBody', 'Button'],
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
          <DialogHeader><DialogTitle>Apply AIProfile</DialogTitle></DialogHeader>
          <DialogBody>Review the AIConfig intent diff before applying it to this capability.</DialogBody>
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
      <strong>Capability detail</strong>
      <span>Local runtime - text.generate</span>
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
      <Button tone="danger" size="sm" onClick={() => setOpen(true)}>Delete draft</Button>
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
    name: 'NimiTabs / PillTabs',
    exportsLabel: 'NimiTabs, PillTabs',
    importNames: ['NimiTabs', 'PillTabs'],
    badge: { label: 'navigation', tone: 'info' },
    wide: true,
    stage: (
      <div className="kit-layout-tabs-recipe grid w-full min-w-0 max-w-2xl gap-6 justify-items-start">
        <TabsDemo />
        <PillTabsDemo />
      </div>
    ),
    extraImports: ["import { useState } from 'react';"],
    snippet: `function TabsRecipe() {
  const [tabsValue, setTabsValue] = useState('overview');
  const [pillValue, setPillValue] = useState('preview');

  return (
    <div className="kit-layout-tabs-recipe grid w-full min-w-0 max-w-2xl gap-6 justify-items-start">
      <NimiTabs
        items={[
          { value: 'overview', label: 'Overview' },
          { value: 'key-props', label: 'Key props' },
          { value: 'design-tokens', label: 'Design tokens' },
        ]}
        value={tabsValue}
        onValueChange={setTabsValue}
        ariaLabel="Recipe view"
      />
      <PillTabs
        items={[
          { value: 'preview', label: 'Preview' },
          { value: 'use', label: 'Use' },
          { value: 'access', label: 'Access' },
        ]}
        value={pillValue}
        onValueChange={setPillValue}
        ariaLabel="Preview mode"
      />
    </div>
  );
}`,
    props: [
      { name: 'items', desc: '{ value, label }[]' },
      { name: 'value', desc: 'active tab value' },
      { name: 'onValueChange', desc: 'tab change callback' },
    ],
  },
  {
    id: 'navigation-primitives',
    category: 'layouts',
    name: 'Breadcrumb, Steps, Pagination',
    exportsLabel: 'Breadcrumb, Steps, Pagination',
    importNames: ['Breadcrumb', 'Steps', 'Pagination'],
    badge: { label: 'navigation', tone: 'info' },
    wide: true,
    stage: (
      <div className="kit-layout-navigation-recipe grid w-full min-w-0 max-w-2xl gap-6 justify-items-start">
        <Breadcrumb
          items={[
            { id: 'kit', label: 'Kit', href: '#kit' },
            { id: 'ui', label: 'UI primitives', href: '#ui' },
            { id: 'data', label: 'Data display' },
          ]}
        />
        <Steps
          ariaLabel="Kit admission path"
          items={[
            { id: 'authority', title: 'Spec aligned', status: 'complete' },
            { id: 'build', title: 'Build surface', status: 'current' },
            { id: 'consume', title: 'Adopt in app', status: 'pending' },
          ]}
        />
        <PaginationDemo />
      </div>
    ),
    extraImports: ["import { useState } from 'react';"],
    snippet: `function NavigationRecipe() {
  const [page, setPage] = useState(2);

  return (
    <div className="kit-layout-navigation-recipe grid w-full min-w-0 max-w-2xl gap-6 justify-items-start">
      <Breadcrumb
        items={[
          { id: 'kit', label: 'Kit', href: '#kit' },
          { id: 'ui', label: 'UI primitives', href: '#ui' },
          { id: 'data', label: 'Data display' },
        ]}
      />
      <Steps
        ariaLabel="Kit admission path"
        items={[
          { id: 'authority', title: 'Spec aligned', status: 'complete' },
          { id: 'build', title: 'Build surface', status: 'current' },
          { id: 'consume', title: 'Adopt in app', status: 'pending' },
        ]}
      />
      <Pagination page={page} pageCount={7} onPageChange={setPage} />
    </div>
  );
}`,
    props: [
      { name: 'items', desc: 'BreadcrumbItem[] or StepItem[] with stable ids' },
      { name: 'page / pageCount', desc: 'controlled pagination cursor' },
      { name: 'onPageChange', desc: 'consumer-owned route or state update' },
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
    name: 'Surface / glass materials',
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
  ...DATA_RECIPES,
];
