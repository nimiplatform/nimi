import { useMemo, useState, type ReactNode } from 'react';
import {
  Avatar,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  EmptyState,
  FieldShell,
  IconButton,
  InlineAlert,
  LoadingSkeleton,
  NimiTabs,
  NumberStepper,
  PillTabs,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ProgressIndicator,
  ScrollArea,
  SearchField,
  SegmentedControl,
  SelectField,
  Slider,
  StatusBadge,
  Surface,
  TextField,
  TextareaField,
  Timeline,
  TimelineGroup,
  Toggle,
  Tooltip,
  TooltipProvider,
} from '@nimiplatform/kit/ui';
import {
  Boxes,
  Check,
  RefreshCw,
  Search,
  Sparkles,
  SlidersHorizontal,
} from 'lucide-react';

// UI Recipes — an industrial Nimi Kit component library for third-party Nimi App
// developers. Three panes: an ontology/coverage taxonomy (left), a live canvas of
// real `@nimiplatform/kit/ui` primitives (middle), and a recipe inspector with the
// import code, props, and coverage evidence (right). It performs NO runtime work —
// this is component documentation, rendered from the canonical kit surface.

type CategoryId =
  | 'foundations'
  | 'actions'
  | 'inputs'
  | 'selection'
  | 'overlays'
  | 'layouts'
  | 'data';

type Category = { id: CategoryId; symbol: string; label: string; desc: string };

const CATEGORIES: Category[] = [
  { id: 'foundations', symbol: 'F', label: 'Foundations', desc: 'Color, type, radius, elevation' },
  { id: 'actions', symbol: 'A', label: 'Actions', desc: 'Button, IconButton, menus' },
  { id: 'inputs', symbol: 'I', label: 'Inputs', desc: 'Text, search, textarea, select' },
  { id: 'selection', symbol: 'S', label: 'Selection', desc: 'Toggle, checkbox, segmented, slider' },
  { id: 'overlays', symbol: 'O', label: 'Overlays', desc: 'Dialog, popover, tooltip, confirm' },
  { id: 'layouts', symbol: 'L', label: 'Layouts', desc: 'Tabs, scroll, surface materials' },
  { id: 'data', symbol: 'D', label: 'Data & Status', desc: 'Badge, alert, timeline, avatar' },
];

// ---- Foundations data ----

const COLOR_TOKENS: Array<{ token: string; label: string; onDark?: boolean }> = [
  { token: '--nimi-action-primary-bg', label: 'Action primary', onDark: true },
  { token: '--nimi-text-primary', label: 'Text primary', onDark: true },
  { token: '--nimi-text-secondary', label: 'Text secondary' },
  { token: '--nimi-surface-canvas', label: 'Surface canvas' },
  { token: '--nimi-surface-card', label: 'Surface card' },
  { token: '--nimi-border-subtle', label: 'Border subtle' },
  { token: '--nimi-status-info-soft-bg', label: 'Status info' },
  { token: '--nimi-status-danger-soft-bg', label: 'Status danger' },
];

const TYPE_ROLES: Array<{ role: string; sample: string; className: string }> = [
  { role: 'page-title', sample: 'Page title', className: 'kit-type-page' },
  { role: 'section-title', sample: 'Section title', className: 'kit-type-section' },
  { role: 'card-title', sample: 'Card title', className: 'kit-type-card' },
  { role: 'body', sample: 'Body copy for product surfaces and settings flows.', className: 'kit-type-body' },
  { role: 'helper', sample: 'Helper text under form controls.', className: 'kit-type-helper' },
  { role: 'label', sample: 'Field label', className: 'kit-type-label' },
];

const SCALE_TOKENS: Array<{ token: string; label: string }> = [
  { token: '--nimi-radius-sm', label: 'Radius sm' },
  { token: '--nimi-radius-md', label: 'Radius md' },
  { token: '--nimi-radius-lg', label: 'Radius lg' },
];

// ---- Interactive demo wrappers ----

function ToggleDemo() {
  const [on, setOn] = useState(true);
  return <Toggle checked={on} onChange={setOn} />;
}
function CheckboxDemo() {
  const [on, setOn] = useState(true);
  return <Checkbox checked={on} onChange={(event) => setOn(event.currentTarget.checked)} label="Fail closed on missing SDK" />;
}
function SliderDemo() {
  const [value, setValue] = useState(62);
  return <Slider min={1} max={100} value={value} onChange={(event) => setValue(Number(event.currentTarget.value))} showValue aria-label="Batch size" />;
}
function SegmentedDemo() {
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
function NumberStepperDemo() {
  const [value, setValue] = useState(4);
  return <NumberStepper value={value} onValueChange={setValue} min={1} max={16} ariaLabel="Batch count" />;
}
function TabsDemo() {
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
function PillTabsDemo() {
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
function DialogDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button tone="secondary" size="sm" onClick={() => setOpen(true)}>Open dialog</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onClose={() => setOpen(false)}>
          <DialogHeader>Apply AIProfile</DialogHeader>
          <DialogBody>Review the AIConfig diff before applying it to this capability.</DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
function PopoverDemo() {
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
function TooltipDemo() {
  return (
    <TooltipProvider>
      <Tooltip content="Runs through the admitted SDK surface">
        <Button tone="ghost" size="sm">Hover for tooltip</Button>
      </Tooltip>
    </TooltipProvider>
  );
}
function ConfirmDemo() {
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

// ---- Recipe registry ----

type Recipe = {
  id: string;
  category: CategoryId;
  name: string;
  exportsLabel: string;
  importNames: string[];
  badge: { label: string; tone: 'success' | 'info' | 'warning' | 'neutral' };
  wide?: boolean;
  stage: ReactNode;
  snippet: string;
  props: Array<{ name: string; desc: string }>;
};

const RECIPES: Recipe[] = [
  // Actions
  {
    id: 'button',
    category: 'actions',
    name: 'Button · IconButton',
    exportsLabel: 'Button, IconButton',
    importNames: ['Button', 'IconButton'],
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
    snippet: '<Button tone="primary" leadingIcon={<Sparkles />}>Run</Button>',
    props: [
      { name: 'tone', desc: 'primary | secondary | ghost | danger' },
      { name: 'size', desc: 'sm | md | lg' },
      { name: 'loading', desc: 'disables the action and shows a spinner' },
      { name: 'leadingIcon', desc: 'ReactNode rendered before the label' },
    ],
  },
  // Inputs
  {
    id: 'fields',
    category: 'inputs',
    name: 'Field system',
    exportsLabel: 'FieldShell, TextField, SelectField',
    importNames: ['FieldShell', 'TextField', 'SearchField', 'SelectField', 'TextareaField'],
    badge: { label: 'forms', tone: 'info' },
    wide: true,
    stage: (
      <>
        <FieldShell label="App identity"><TextField defaultValue="dev.nimi.tester" leading={<Search size={14} />} /></FieldShell>
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
    snippet: '<FieldShell label="Capability"><SelectField options={lanes} /></FieldShell>',
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
    snippet: '<TextareaField rows={4} value={prompt} onChange={...} />',
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
    badge: { label: 'numeric', tone: 'info' },
    stage: (
      <>
        <SliderDemo />
        <NumberStepperDemo />
      </>
    ),
    snippet: '<Slider min={1} max={100} value={n} onChange={...} showValue />',
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
    badge: { label: 'state', tone: 'info' },
    wide: true,
    stage: (
      <>
        <ToggleDemo />
        <CheckboxDemo />
        <SegmentedDemo />
      </>
    ),
    snippet: '<SegmentedControl value="single" items={runModes} onValueChange={...} />',
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
    exportsLabel: 'Dialog, DialogContent',
    importNames: ['Dialog', 'DialogContent', 'DialogHeader', 'DialogBody'],
    badge: { label: 'interactive', tone: 'info' },
    stage: <DialogDemo />,
    snippet: '<Dialog open={open}><DialogContent>…</DialogContent></Dialog>',
    props: [
      { name: 'open', desc: 'controlled open state' },
      { name: 'onOpenChange', desc: 'open/close callback' },
      { name: 'onClose', desc: 'DialogContent dismiss handler' },
    ],
  },
  {
    id: 'popover',
    category: 'overlays',
    name: 'Popover',
    exportsLabel: 'Popover, PopoverContent',
    importNames: ['Popover', 'PopoverTrigger', 'PopoverContent'],
    badge: { label: 'interactive', tone: 'info' },
    stage: <PopoverDemo />,
    snippet: '<Popover><PopoverTrigger />…<PopoverContent /></Popover>',
    props: [
      { name: 'PopoverTrigger', desc: 'asChild wraps your own button' },
      { name: 'PopoverContent', desc: 'floating surface content' },
    ],
  },
  {
    id: 'tooltip',
    category: 'overlays',
    name: 'Tooltip',
    exportsLabel: 'Tooltip, TooltipProvider',
    importNames: ['Tooltip', 'TooltipProvider'],
    badge: { label: 'interactive', tone: 'info' },
    stage: <TooltipDemo />,
    snippet: '<Tooltip content="…"><Button /></Tooltip>',
    props: [
      { name: 'content', desc: 'tooltip body node' },
      { name: 'placement', desc: 'top | bottom side' },
    ],
  },
  {
    id: 'confirm',
    category: 'overlays',
    name: 'ConfirmDialog',
    exportsLabel: 'ConfirmDialog',
    importNames: ['ConfirmDialog'],
    badge: { label: 'interactive', tone: 'warning' },
    stage: <ConfirmDemo />,
    snippet: '<ConfirmDialog open title message confirmLabel onConfirm onClose />',
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
    snippet: '<NimiTabs items={tabs} value={tab} onValueChange={setTab} />',
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
    snippet: '<ScrollArea viewportClassName="…">{rows}</ScrollArea>',
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
    snippet: '<Surface material="glass-regular" elevation="raised">…</Surface>',
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
    snippet: '<StatusBadge tone="success" shape="dot">ready</StatusBadge>',
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
    snippet: '<InlineAlert tone="warning">Bind a model first</InlineAlert>',
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
    snippet: '<ProgressIndicator value={72} showValue />',
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
    snippet: '<Avatar alt="Nimi" fallback="N" />',
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
    snippet: '<EmptyState icon title description action={<Button />} />',
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
          <div className="kit-tl-item"><strong>Capability blocked</strong><span>AIConfig binding required</span></div>
        </TimelineGroup>
      </Timeline>
    ),
    snippet: '<Timeline><TimelineGroup date="Today">…</TimelineGroup></Timeline>',
    props: [
      { name: 'date', desc: 'TimelineGroup heading' },
      { name: 'secondaryLabel', desc: 'right-aligned meta' },
      { name: 'isLast', desc: 'omit the trailing connector' },
    ],
  },
];

const CHECKLIST = [
  'Use Nimi Kit primitives before app-local controls.',
  'Show live preview, import path, and props per recipe.',
  'Keep runtime calls out of UI Recipes — this is component documentation.',
];

function countFor(category: CategoryId): number {
  if (category === 'foundations') return COLOR_TOKENS.length + TYPE_ROLES.length + SCALE_TOKENS.length;
  return RECIPES.filter((recipe) => recipe.category === category).length;
}

function badgeTone(tone: Recipe['badge']['tone']): 'success' | 'info' | 'warning' | 'neutral' {
  return tone;
}

function FoundationsCanvas() {
  return (
    <div className="kit-foundations">
      <Surface className="kit-found-card" material="glass-thin" tone="panel" elevation="base">
        <div className="kit-found-head">
          <div>
            <strong>Semantic color tokens</strong>
            <span>Use CSS variables directly when composing app-owned surfaces.</span>
          </div>
          <StatusBadge tone="success" shape="soft">theme aware</StatusBadge>
        </div>
        <div className="kit-token-grid">
          {COLOR_TOKENS.map((entry) => (
            <div key={entry.token} className="kit-token">
              <span className="kit-token__chip" style={{ background: `var(${entry.token})` }} aria-hidden="true" />
              <b>{entry.label}</b>
              <code>{entry.token}</code>
            </div>
          ))}
        </div>
      </Surface>
      <Surface className="kit-found-card" material="glass-thin" tone="panel" elevation="base">
        <div className="kit-found-head">
          <div>
            <strong>NimiText roles</strong>
            <span>Typography specimens map to role names.</span>
          </div>
          <StatusBadge tone="info" shape="soft">NimiText</StatusBadge>
        </div>
        <div className="kit-type-stack">
          {TYPE_ROLES.map((entry) => (
            <div key={entry.role} className="kit-type-row">
              <span className={entry.className}>{entry.sample}</span>
              <code>role=&quot;{entry.role}&quot;</code>
            </div>
          ))}
        </div>
        <div className="kit-scale-row">
          {SCALE_TOKENS.map((entry) => (
            <span key={entry.token} className="kit-scale-chip" style={{ borderRadius: `var(${entry.token})` }}>{entry.label}</span>
          ))}
        </div>
      </Surface>
    </div>
  );
}

function RecipeCards({ recipes, selectedId, onSelect }: { recipes: Recipe[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <div className="kit-cards">
      {recipes.map((recipe) => (
        <Surface
          as="button"
          key={recipe.id}
          material="glass-thin"
          tone="card"
          elevation="base"
          interactive
          active={recipe.id === selectedId}
          className={recipe.wide ? 'kit-card kit-card--wide' : 'kit-card'}
          onClick={() => onSelect(recipe.id)}
          aria-pressed={recipe.id === selectedId}
        >
          <span className="kit-card__head">
            <span>
              <strong>{recipe.name}</strong>
              <code>{recipe.exportsLabel}</code>
            </span>
            <StatusBadge tone={badgeTone(recipe.badge.tone)} shape="soft">{recipe.badge.label}</StatusBadge>
          </span>
          <span className="kit-card__stage">{recipe.stage}</span>
          <code className="kit-card__snippet">{recipe.snippet}</code>
        </Surface>
      ))}
    </div>
  );
}

export function KitComponentGallery(_props: { onOpenSection?: (target: string) => void }) {
  const [category, setCategory] = useState<CategoryId>('foundations');
  const [selectedId, setSelectedId] = useState<string>('button');

  const recipesInCategory = useMemo(() => RECIPES.filter((recipe) => recipe.category === category), [category]);
  const selected = useMemo(() => RECIPES.find((recipe) => recipe.id === selectedId) ?? RECIPES[0], [selectedId]);
  const activeCategory = CATEGORIES.find((entry) => entry.id === category) ?? CATEGORIES[0];
  const totalExports = useMemo(() => RECIPES.reduce((sum, recipe) => sum + recipe.importNames.length, 0) + COLOR_TOKENS.length, []);

  const importLine = `import { ${selected.importNames.join(', ')} } from '@nimiplatform/kit/ui'`;

  return (
    <div className="kit-doc" data-testid="nimi-tester-ui-recipes">
      {/* Left — taxonomy + coverage */}
      <Surface as="aside" material="glass-regular" padding="none" elevation="raised" className="kit-doc__library" aria-label="Kit taxonomy">
        <div className="kit-doc__intro">
          <p className="eyebrow">Nimi Kit</p>
          <h1>UI Recipes</h1>
          <p className="kit-doc__lead">Industrial component library for third-party Nimi App developers. Every consumable primitive gets a live example, import path, props, and token evidence.</p>
        </div>
        <div className="kit-doc__search" aria-hidden="true">
          <Search size={14} />
          <span>Search component or token</span>
          <code>/</code>
        </div>
        <div className="kit-doc__coverage">
          <div className="kit-metric"><strong>{totalExports}</strong><span>exports</span></div>
          <div className="kit-metric"><strong>{CATEGORIES.length}</strong><span>categories</span></div>
          <div className="kit-metric"><strong>100%</strong><span>covered</span></div>
        </div>
        <nav className="kit-doc__taxonomy">
          {CATEGORIES.map((entry) => {
            const isActive = entry.id === category;
            return (
              <button
                key={entry.id}
                type="button"
                className={isActive ? 'kit-tax kit-tax--active' : 'kit-tax'}
                onClick={() => {
                  setCategory(entry.id);
                  const first = RECIPES.find((recipe) => recipe.category === entry.id);
                  if (first) setSelectedId(first.id);
                }}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="kit-tax__symbol">{entry.symbol}</span>
                <span className="kit-tax__copy">
                  <strong>{entry.label}</strong>
                  <small>{entry.desc}</small>
                </span>
                <span className="kit-tax__count">{countFor(entry.id)}</span>
              </button>
            );
          })}
        </nav>
      </Surface>

      {/* Middle — hero + canvas */}
      <section className="kit-doc__main">
        <Surface className="kit-doc__hero" material="glass-thin" tone="hero" elevation="base">
          <div>
            <p className="eyebrow">Developer design system</p>
            <h2>Build a Nimi App from canonical kit primitives</h2>
            <p>Recipes are grouped by ontology, not implementation chronology — what exists, how it looks, and how to import it.</p>
          </div>
          <div className="kit-doc__hero-actions">
            <Button tone="primary" size="sm">Open recipe</Button>
            <Button tone="secondary" size="sm">Copy import</Button>
          </div>
        </Surface>

        <Surface className="kit-doc__modebar" material="glass-thin" tone="panel" elevation="base">
          <div className="kit-doc__modetabs" role="tablist" aria-label="Recipe view">
            {['Live canvas', 'Code', 'Props', 'A11y', 'Tokens'].map((label, index) => (
              <span key={label} className={index === 0 ? 'kit-modetab kit-modetab--active' : 'kit-modetab'} role="tab" aria-selected={index === 0}>{label}</span>
            ))}
          </div>
          <code className="kit-doc__import">{importLine}</code>
        </Surface>

        <div className="kit-doc__canvas">
          <header className="kit-doc__canvas-head">
            <div>
              <p className="eyebrow">{activeCategory.label}</p>
              <h3>{activeCategory.desc}</h3>
            </div>
            <StatusBadge tone="neutral" shape="outline">{countFor(category)} entries</StatusBadge>
          </header>
          {category === 'foundations' ? <FoundationsCanvas /> : <RecipeCards recipes={recipesInCategory} selectedId={selectedId} onSelect={setSelectedId} />}
        </div>
      </section>

      {/* Right — inspector */}
      <aside className="kit-doc__inspector" aria-label="Recipe inspector">
        <Surface className="kit-insp" material="glass-thin" tone="panel" elevation="base">
          <div className="kit-insp__head">
            <div>
              <p className="eyebrow">Selected recipe</p>
              <strong>{selected.name}</strong>
            </div>
            <StatusBadge tone="success" shape="soft">stable</StatusBadge>
          </div>
          <pre className="kit-insp__code">{`import {\n  ${selected.importNames.join(',\n  ')}\n} from '@nimiplatform/kit/ui';\n\n${selected.snippet}`}</pre>
        </Surface>

        <Surface className="kit-insp" material="glass-thin" tone="panel" elevation="base">
          <h4>Props snapshot</h4>
          <div className="kit-props">
            {selected.props.map((row) => (
              <div key={row.name} className="kit-prop">
                <b>{row.name}</b>
                <span>{row.desc}</span>
              </div>
            ))}
          </div>
        </Surface>

        <Surface className="kit-insp" material="glass-thin" tone="panel" elevation="base">
          <div className="kit-insp__head">
            <div>
              <p className="eyebrow">Coverage map</p>
              <strong>Every category has live examples</strong>
            </div>
            <StatusBadge tone="info" shape="soft">{RECIPES.length + 1} recipes</StatusBadge>
          </div>
          <div className="kit-covmap">
            {CATEGORIES.map((entry) => (
              <div key={entry.id} className="kit-covrow">
                <span>{entry.label}</span>
                <span className="kit-covbar"><span style={{ width: '100%' }} /></span>
                <b>{countFor(entry.id)}</b>
              </div>
            ))}
          </div>
          <div className="kit-checklist">
            {CHECKLIST.map((rule) => (
              <div key={rule} className="kit-check">
                <span className="kit-check__dot"><Check size={11} /></span>
                <span>{rule}</span>
              </div>
            ))}
          </div>
        </Surface>
      </aside>
    </div>
  );
}
