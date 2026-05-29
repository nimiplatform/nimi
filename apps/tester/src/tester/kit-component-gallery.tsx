import { useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Bell,
  Boxes,
  ChevronDown,
  CircleAlert,
  ClipboardCheck,
  Code2,
  Copy,
  Cpu,
  FileSearch,
  FormInput,
  GalleryHorizontalEnd,
  Layers,
  MessageSquare,
  MoreHorizontal,
  MousePointerClick,
  PanelsTopLeft,
  PencilRuler,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  ToggleLeft,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  ActionMenu,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FieldShell,
  IconButton,
  InlineAlert,
  LoadingSkeleton,
  NimiTabs,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ProgressIndicator,
  ScrollArea,
  SegmentedControl,
  SelectField,
  Slider,
  StatusBadge,
  Surface,
  TextareaField,
  TextField,
  Toggle,
} from '@nimiplatform/kit/ui';
import type { WorkbenchSectionId } from './workbench/workbench-context.js';

type Boundary = 'do' | 'dont';
type RecipeState = 'ready' | 'loading' | 'blocked' | 'empty' | 'local-fixture' | 'unavailable';

type RecipeUsage = {
  intent: string;
  imports: string[];
  boundaries: Array<{ kind: Boundary; copy: string }>;
};

type Recipe = {
  id: string;
  name: string;
  variants: string[];
  anatomy: string[];
  preview: ReactNode;
  usage: RecipeUsage;
};

type FamilyId = 'actions' | 'inputs' | 'toggles' | 'feedback' | 'overlays' | 'surfaces' | 'states';

type Family = {
  id: FamilyId;
  label: string;
  description: string;
  icon: LucideIcon;
};

type SurfaceScenario = {
  id: string;
  title: string;
  workflow: string;
  icon: LucideIcon;
  intent: string;
  primitives: string[];
  states: RecipeState[];
  defaultState: RecipeState;
  steps: string[];
  imports: string[];
  boundaries: string[];
  workflowLinks: Array<{ label: string; section: WorkbenchSectionId; note: string }>;
  families: FamilyId[];
};

const families: Family[] = [
  { id: 'actions', label: 'Actions', description: 'Buttons, icon buttons, action menus.', icon: MousePointerClick },
  { id: 'inputs', label: 'Inputs', description: 'TextField, TextareaField, SelectField, FieldShell.', icon: FormInput },
  { id: 'toggles', label: 'Toggles & selection', description: 'Toggle, Checkbox, Slider, SegmentedControl, NimiTabs.', icon: ToggleLeft },
  { id: 'feedback', label: 'Status & progress', description: 'StatusBadge, InlineAlert, ProgressIndicator.', icon: CircleAlert },
  { id: 'overlays', label: 'Overlays', description: 'Dialog, Popover, ActionMenu surface.', icon: Layers },
  { id: 'surfaces', label: 'Surfaces', description: 'Surface materials, ScrollArea, dense rows.', icon: PanelsTopLeft },
  { id: 'states', label: 'Empty / loading / error', description: 'EmptyState, LoadingSkeleton, fail-closed error surface.', icon: AlertCircle },
];

const recipes: Record<FamilyId, Recipe[]> = {
  actions: [
    {
      id: 'button',
      name: 'Button',
      variants: ['primary', 'secondary', 'ghost', 'danger', 'loading'],
      anatomy: ['tone', 'size', 'leadingIcon', 'trailingIcon', 'loading'],
      preview: (
        <div className="recipe-cluster">
          <Button tone="primary" leadingIcon={<Play size={14} />}>Run lane</Button>
          <Button tone="secondary" leadingIcon={<RefreshCw size={14} />}>Refresh</Button>
          <Button tone="ghost" leadingIcon={<Copy size={14} />}>Copy trace</Button>
          <Button tone="danger" leadingIcon={<X size={14} />}>Stop</Button>
          <Button loading>Checking</Button>
        </div>
      ),
      usage: {
        intent: 'Primary call-to-action inside cockpit panels; never wrap with custom shells.',
        imports: ['Button from @nimiplatform/kit/ui'],
        boundaries: [
          { kind: 'do', copy: 'Pair the icon and label so the action reads on every density.' },
          { kind: 'dont', copy: 'Do not stack two primary buttons next to each other in the same row.' },
        ],
      },
    },
    {
      id: 'icon-button',
      name: 'IconButton',
      variants: ['ghost', 'primary', 'secondary', 'sm/md'],
      anatomy: ['icon', 'tone', 'size', 'aria-label'],
      preview: (
        <div className="recipe-cluster">
          <IconButton aria-label="Search routes" icon={<Search size={14} />} />
          <IconButton aria-label="Open settings" icon={<Settings size={14} />} />
          <IconButton aria-label="Add workflow" tone="primary" icon={<Plus size={14} />} />
          <IconButton aria-label="More" tone="secondary" icon={<MoreHorizontal size={14} />} />
        </div>
      ),
      usage: {
        intent: 'Compact actions in toolbars and table rows where labels would crowd the layout.',
        imports: ['IconButton from @nimiplatform/kit/ui'],
        boundaries: [
          { kind: 'do', copy: 'Always set aria-label so screen readers can announce the action.' },
          { kind: 'dont', copy: 'Never use IconButton as the only primary submit affordance.' },
        ],
      },
    },
    {
      id: 'action-menu',
      name: 'ActionMenu',
      variants: ['default', 'danger', 'icon prefix'],
      anatomy: ['items', 'ariaLabel', 'onSelect'],
      preview: (
        <ActionMenu
          ariaLabel="Recipe actions"
          items={[
            { id: 'copy', label: 'Copy request trace', icon: <Copy size={13} /> },
            { id: 'rerun', label: 'Run again', icon: <RefreshCw size={13} /> },
            { id: 'stop', label: 'Stop lane', icon: <X size={13} />, tone: 'danger' },
          ]}
        />
      ),
      usage: {
        intent: 'Inline overflow actions next to a header or row; keyboard reachable by default.',
        imports: ['ActionMenu from @nimiplatform/kit/ui'],
        boundaries: [
          { kind: 'do', copy: 'Use the danger tone to mark destructive entries (stop/clear).' },
          { kind: 'dont', copy: 'Do not nest menus inside menus — use a Dialog if you need depth.' },
        ],
      },
    },
  ],
  inputs: [
    {
      id: 'text-field',
      name: 'TextField',
      variants: ['default', 'leading icon', 'readonly'],
      anatomy: ['leading', 'placeholder', 'value', 'onChange'],
      preview: (
        <FieldShell label="Route name" description="Stored as app-owned draft data.">
          <TextField defaultValue="Runtime readiness route" leading={<TerminalSquare size={14} />} />
        </FieldShell>
      ),
      usage: {
        intent: 'Single-line input for scenario names, labels, or identifiers.',
        imports: ['TextField, FieldShell from @nimiplatform/kit/ui'],
        boundaries: [
          { kind: 'do', copy: 'Wrap in FieldShell to inherit label + description rhythm.' },
          { kind: 'dont', copy: 'Avoid raw <input> elements — they bypass theme tokens.' },
        ],
      },
    },
    {
      id: 'textarea-field',
      name: 'TextareaField',
      variants: ['multiline', 'rows=4', 'controlled'],
      anatomy: ['rows', 'value', 'onChange'],
      preview: (
        <FieldShell label="Request body">
          <TextareaField rows={4} defaultValue="Validate the active Nimi App runtime route without app-local provider defaults." />
        </FieldShell>
      ),
      usage: {
        intent: 'Scenario prompts, structured request payloads, multi-line config.',
        imports: ['TextareaField, FieldShell from @nimiplatform/kit/ui'],
        boundaries: [
          { kind: 'do', copy: 'Default rows to 4 in cockpit panels to fit two scroll lines.' },
          { kind: 'dont', copy: 'Do not stretch a single textarea past 8 rows; switch to a Dialog instead.' },
        ],
      },
    },
    {
      id: 'select-field',
      name: 'SelectField',
      variants: ['options', 'controlled', 'aria-label'],
      anatomy: ['options', 'value', 'onValueChange'],
      preview: (
        <FieldShell label="Capability route">
          <SelectField
            defaultValue="text.generate"
            options={[
              { value: 'text.generate', label: 'Text generation' },
              { value: 'chat.stream', label: 'Chat stream' },
              { value: 'image.generate', label: 'Image generation' },
              { value: 'world.generate', label: 'World tour' },
            ]}
            aria-label="Capability route"
          />
        </FieldShell>
      ),
      usage: {
        intent: 'Pick from a closed set of admitted lanes or providers.',
        imports: ['SelectField, FieldShell from @nimiplatform/kit/ui'],
        boundaries: [
          { kind: 'do', copy: 'Provide aria-label even when nested in a FieldShell.' },
          { kind: 'dont', copy: 'Do not use SelectField for free-text — use TextField instead.' },
        ],
      },
    },
    {
      id: 'field-shell',
      name: 'FieldShell',
      variants: ['label only', 'label + description', 'slot composition'],
      anatomy: ['label', 'description', 'children'],
      preview: (
        <FieldShell label="Session token" description="FieldShell wraps any input control with consistent rhythm and a11y labels.">
          <TextField defaultValue="developer-local-device" />
        </FieldShell>
      ),
      usage: {
        intent: 'Shared label/description/error slot for every input primitive.',
        imports: ['FieldShell from @nimiplatform/kit/ui'],
        boundaries: [
          { kind: 'do', copy: 'Use the description slot for guidance, not for errors.' },
          { kind: 'dont', copy: 'Do not build custom label markup that bypasses FieldShell.' },
        ],
      },
    },
  ],
  toggles: [
    {
      id: 'toggle',
      name: 'Toggle',
      variants: ['controlled', 'disabled'],
      anatomy: ['checked', 'onChange(boolean)'],
      preview: <TogglePreview />,
      usage: {
        intent: 'Binary switches for runtime-bound features (tracing, verbose console).',
        imports: ['Toggle from @nimiplatform/kit/ui'],
        boundaries: [
          { kind: 'do', copy: 'Pair the toggle with a label that names the bound capability.' },
          { kind: 'dont', copy: 'Do not use Toggle for ternary state — switch to SegmentedControl.' },
        ],
      },
    },
    {
      id: 'checkbox',
      name: 'Checkbox',
      variants: ['label', 'checked', 'disabled'],
      anatomy: ['label', 'checked', 'onChange'],
      preview: <CheckboxPreview />,
      usage: {
        intent: 'Persistent settings that survive sessions (fail-closed guardrails).',
        imports: ['Checkbox from @nimiplatform/kit/ui'],
        boundaries: [
          { kind: 'do', copy: 'Always render the label inline; do not hide it as a tooltip.' },
          { kind: 'dont', copy: 'Do not use Checkbox for runtime mutations — use a Button.' },
        ],
      },
    },
    {
      id: 'slider',
      name: 'Slider',
      variants: ['showValue', 'aria-label', 'min/max'],
      anatomy: ['min', 'max', 'value', 'onChange'],
      preview: <SliderPreview />,
      usage: {
        intent: 'Numeric ranges where the precise value can be derived from position.',
        imports: ['Slider from @nimiplatform/kit/ui'],
        boundaries: [
          { kind: 'do', copy: 'Pair with a numeric readout when the range exceeds 0–100.' },
          { kind: 'dont', copy: 'Do not use a slider for discrete options — use SegmentedControl.' },
        ],
      },
    },
    {
      id: 'segmented-control',
      name: 'SegmentedControl',
      variants: ['icon prefix', 'size=sm'],
      anatomy: ['items', 'value', 'onValueChange'],
      preview: <SegmentedPreview />,
      usage: {
        intent: 'Pick one of 2–4 mutually exclusive options inline.',
        imports: ['SegmentedControl from @nimiplatform/kit/ui'],
        boundaries: [
          { kind: 'do', copy: 'Keep labels under 12 chars so the segments do not wrap.' },
          { kind: 'dont', copy: 'Do not exceed 5 segments — switch to a SelectField.' },
        ],
      },
    },
    {
      id: 'nimi-tabs',
      name: 'NimiTabs',
      variants: ['controlled value', 'disabled tab'],
      anatomy: ['items', 'value', 'onValueChange'],
      preview: <TabsPreview />,
      usage: {
        intent: 'Section navigation inside a card or panel.',
        imports: ['NimiTabs from @nimiplatform/kit/ui'],
        boundaries: [
          { kind: 'do', copy: 'Mark not-yet-admitted tabs disabled instead of hiding them.' },
          { kind: 'dont', copy: 'Do not nest NimiTabs inside another tab strip.' },
        ],
      },
    },
  ],
  feedback: [
    {
      id: 'status-badge',
      name: 'StatusBadge',
      variants: ['success', 'warning', 'danger', 'info', 'dot', 'outline'],
      anatomy: ['tone', 'shape'],
      preview: (
        <div className="recipe-cluster">
          <StatusBadge tone="success" shape="dot">session ready</StatusBadge>
          <StatusBadge tone="warning" shape="dot">sdk gap</StatusBadge>
          <StatusBadge tone="danger" shape="outline">blocked</StatusBadge>
          <StatusBadge tone="info">developer</StatusBadge>
        </div>
      ),
      usage: {
        intent: 'Convey contract state inline next to identifiers and surface names.',
        imports: ['StatusBadge from @nimiplatform/kit/ui'],
        boundaries: [
          { kind: 'do', copy: 'Use the dot shape for live status; reserve outline for snapshot state.' },
          { kind: 'dont', copy: 'Do not stack three badges side-by-side; promote to an InlineAlert.' },
        ],
      },
    },
    {
      id: 'progress',
      name: 'ProgressIndicator',
      variants: ['showValue', 'inline'],
      anatomy: ['value', 'showValue'],
      preview: <ProgressIndicator value={72} showValue />,
      usage: {
        intent: 'Surface real progress derived from runtime state (never decorative).',
        imports: ['ProgressIndicator from @nimiplatform/kit/ui'],
        boundaries: [
          { kind: 'do', copy: 'Only render a value if it is bound to a real running task.' },
          { kind: 'dont', copy: 'Do not animate a fake progress bar to mask unreadiness.' },
        ],
      },
    },
    {
      id: 'inline-alert',
      name: 'InlineAlert',
      variants: ['info', 'warning', 'icon slot'],
      anatomy: ['tone', 'icon', 'children'],
      preview: (
        <div className="recipe-cluster recipe-cluster--stack">
          <InlineAlert tone="info" icon={<Bell size={14} />}>
            <div className="runtime-alert-copy">
              <strong>Runtime-bound surface</strong>
              <span>Execution proof comes from SDK calls or typed unavailable states.</span>
            </div>
          </InlineAlert>
          <InlineAlert tone="warning" icon={<AlertTriangle size={14} />}>
            <div className="runtime-alert-copy">
              <strong>Missing admitted SDK method</strong>
              <span>The workflow can render controls but cannot claim execution readiness.</span>
            </div>
          </InlineAlert>
        </div>
      ),
      usage: {
        intent: 'Long-form contract messages that need narrative + headline.',
        imports: ['InlineAlert from @nimiplatform/kit/ui'],
        boundaries: [
          { kind: 'do', copy: 'Surface typed reasons; cite the SDK method or admission gap directly.' },
          { kind: 'dont', copy: 'Do not collapse the headline into the body — readers scan the strong tag.' },
        ],
      },
    },
  ],
  overlays: [
    {
      id: 'dialog',
      name: 'Dialog',
      variants: ['header', 'body', 'footer', 'controlled open'],
      anatomy: ['open', 'onOpenChange'],
      preview: <DialogPreview />,
      usage: {
        intent: 'Modal flows that interrupt the cockpit when an admission decision is required.',
        imports: ['Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter from @nimiplatform/kit/ui'],
        boundaries: [
          { kind: 'do', copy: 'Always render a primary action that resolves the modal.' },
          { kind: 'dont', copy: 'Do not nest dialogs; chain step screens inside the body instead.' },
        ],
      },
    },
    {
      id: 'popover',
      name: 'Popover',
      variants: ['trigger', 'content', 'asChild composition'],
      anatomy: ['trigger', 'content'],
      preview: (
        <Popover>
          <PopoverTrigger asChild>
            <Button tone="secondary" trailingIcon={<ChevronDown size={14} />}>Route details</Button>
          </PopoverTrigger>
          <PopoverContent className="recipe-popover">
            <strong>Runtime route contract</strong>
            <span>Capability, prompt, diagnostics, and typed unavailable state travel together.</span>
          </PopoverContent>
        </Popover>
      ),
      usage: {
        intent: 'Compact context-helpers anchored to a control without a full modal.',
        imports: ['Popover, PopoverTrigger, PopoverContent from @nimiplatform/kit/ui'],
        boundaries: [
          { kind: 'do', copy: 'Use the asChild trigger so the kit Button keeps its tone tokens.' },
          { kind: 'dont', copy: 'Do not place form inputs inside a Popover — use a Dialog.' },
        ],
      },
    },
    {
      id: 'menu-surface',
      name: 'ActionMenu surface',
      variants: ['inside Surface', 'sticky in panel'],
      anatomy: ['Surface', 'ActionMenu'],
      preview: (
        <Surface className="recipe-menu" material="glass-thin" tone="panel">
          <div className="recipe-menu__top">
            <StatusBadge tone="neutral">lane tools</StatusBadge>
            <IconButton aria-label="Open menu" icon={<MoreHorizontal size={14} />} />
          </div>
          <ActionMenu
            ariaLabel="Lane tools"
            items={[
              { id: 'inspect', label: 'Inspect payload', icon: <Search size={13} /> },
              { id: 'settings', label: 'Open settings', icon: <Settings size={13} /> },
              { id: 'clear', label: 'Clear draft', icon: <X size={13} />, tone: 'danger' },
            ]}
          />
        </Surface>
      ),
      usage: {
        intent: 'Composite recipe: anchor an ActionMenu in a Surface with a status header.',
        imports: ['Surface, ActionMenu, IconButton, StatusBadge from @nimiplatform/kit/ui'],
        boundaries: [
          { kind: 'do', copy: 'Cap the menu with a status row so users see context before tapping.' },
          { kind: 'dont', copy: 'Do not duplicate the menu items in the surface body.' },
        ],
      },
    },
  ],
  surfaces: [
    {
      id: 'surface-materials',
      name: 'Surface materials',
      variants: ['glass-thin', 'glass-regular', 'glass-thick overlay'],
      anatomy: ['material', 'tone', 'elevation'],
      preview: (
        <div className="recipe-surface-row">
          <Surface material="glass-thin" tone="card" className="recipe-mini-surface">
            <Sparkles size={16} />
            <strong>Thin glass</strong>
          </Surface>
          <Surface material="glass-regular" tone="panel" className="recipe-mini-surface">
            <ShieldCheck size={16} />
            <strong>Regular</strong>
          </Surface>
          <Surface material="glass-thick" tone="overlay" elevation="floating" className="recipe-mini-surface">
            <SlidersHorizontal size={16} />
            <strong>Overlay</strong>
          </Surface>
        </div>
      ),
      usage: {
        intent: 'Compose layered panels using kit material tokens — never custom box-shadow stacks.',
        imports: ['Surface from @nimiplatform/kit/ui'],
        boundaries: [
          { kind: 'do', copy: 'Pick thin glass for inline cards, overlay for modals + menus.' },
          { kind: 'dont', copy: 'Do not nest more than two glass surfaces in the same column.' },
        ],
      },
    },
    {
      id: 'scroll-area',
      name: 'ScrollArea',
      variants: ['viewport', 'sticky size', 'dense rows'],
      anatomy: ['viewportClassName', 'contentClassName'],
      preview: <ScrollAreaPreview />,
      usage: {
        intent: 'Long lists (runs, artifacts, traces) inside fixed-height panels.',
        imports: ['ScrollArea from @nimiplatform/kit/ui'],
        boundaries: [
          { kind: 'do', copy: 'Set an explicit height so the scrollbar appears predictably.' },
          { kind: 'dont', copy: 'Do not wrap an already-scrolling element in a ScrollArea.' },
        ],
      },
    },
    {
      id: 'dense-card',
      name: 'Dense card',
      variants: ['heading', 'metric row', 'inline action'],
      anatomy: ['Surface', 'eyebrow', 'metric'],
      preview: (
        <Surface material="glass-thin" tone="card" className="recipe-dense-card">
          <div>
            <p className="eyebrow">Active sessions</p>
            <strong>3 lanes ready</strong>
          </div>
          <PencilRuler size={16} />
        </Surface>
      ),
      usage: {
        intent: 'Inline KPI tile pattern; compose with Surface + eyebrow + metric.',
        imports: ['Surface from @nimiplatform/kit/ui'],
        boundaries: [
          { kind: 'do', copy: 'Show the actual count from runtime state, not a placeholder.' },
          { kind: 'dont', copy: 'Do not chart with custom canvases inside a dense card.' },
        ],
      },
    },
  ],
  states: [
    {
      id: 'empty-state',
      name: 'EmptyState',
      variants: ['icon', 'title', 'description', 'optional action'],
      anatomy: ['icon', 'title', 'description', 'action'],
      preview: (
        <EmptyState
          icon={<Boxes size={18} />}
          title="No captured artifacts"
          description="Run a real capability or resolve a typed blocker before this list fills."
          action={<Button size="sm" tone="secondary" leadingIcon={<RefreshCw size={13} />}>Refresh</Button>}
        />
      ),
      usage: {
        intent: 'Tell the developer exactly which action populates the surface.',
        imports: ['EmptyState, Button from @nimiplatform/kit/ui'],
        boundaries: [
          { kind: 'do', copy: 'Name the action and the source store that will fill the surface.' },
          { kind: 'dont', copy: 'Do not show invented placeholder rows under the empty state.' },
        ],
      },
    },
    {
      id: 'loading-skeleton',
      name: 'LoadingSkeleton',
      variants: ['lines', 'shimmer', 'rhythm match'],
      anatomy: ['lines'],
      preview: <LoadingSkeleton lines={4} />,
      usage: {
        intent: 'Mirror the destination layout while real data is in flight.',
        imports: ['LoadingSkeleton from @nimiplatform/kit/ui'],
        boundaries: [
          { kind: 'do', copy: 'Match the skeleton line count to the eventual content rhythm.' },
          { kind: 'dont', copy: 'Do not show a skeleton when the call has already failed — surface an error.' },
        ],
      },
    },
    {
      id: 'error-surface',
      name: 'Runtime projection blocked',
      variants: ['icon', 'title', 'reason'],
      anatomy: ['Surface', 'AlertTriangle', 'typed reason'],
      preview: (
        <Surface className="recipe-error-state" material="glass-thin" tone="card">
          <AlertTriangle size={16} />
          <div>
            <strong>Runtime projection blocked</strong>
            <span>Third-party session projection is not exposed by this SDK/runtime pair.</span>
          </div>
        </Surface>
      ),
      usage: {
        intent: 'Fail-closed surface for typed runtime/SDK gaps.',
        imports: ['Surface from @nimiplatform/kit/ui', 'AlertTriangle icon'],
        boundaries: [
          { kind: 'do', copy: 'Quote the typed reason verbatim from the SDK error.' },
          { kind: 'dont', copy: 'Do not retry silently — escalate the typed reason to the developer.' },
        ],
      },
    },
  ],
};

function TogglePreview() {
  const [value, setValue] = useState(true);
  return (
    <div className="recipe-form-row">
      <span>Trace runtime calls</span>
      <Toggle checked={value} onChange={setValue} />
    </div>
  );
}

function CheckboxPreview() {
  const [value, setValue] = useState(true);
  return (
    <Checkbox
      checked={value}
      onChange={(event) => setValue(event.currentTarget.checked)}
      label="Fail closed on missing SDK surface"
    />
  );
}

function SliderPreview() {
  const [value, setValue] = useState(62);
  return (
    <Slider min={1} max={100} value={value} onChange={(event) => setValue(Number(event.currentTarget.value))} showValue aria-label="Batch size" />
  );
}

function SegmentedPreview() {
  const [value, setValue] = useState('review');
  return (
    <SegmentedControl
      items={[
        { value: 'review', label: 'Review', icon: <ClipboardCheck size={13} /> },
        { value: 'author', label: 'Author', icon: <Code2 size={13} /> },
        { value: 'runtime', label: 'Runtime', icon: <Cpu size={13} /> },
      ]}
      value={value}
      onValueChange={setValue}
      ariaLabel="Density"
      size="sm"
    />
  );
}

function TabsPreview() {
  const [value, setValue] = useState('request');
  return (
    <NimiTabs
      items={[
        { value: 'request', label: 'Request' },
        { value: 'diagnostics', label: 'Diagnostics' },
        { value: 'artifacts', label: 'Artifacts', disabled: true },
      ]}
      value={value}
      onValueChange={setValue}
      ariaLabel="Tabs"
    />
  );
}

function DialogPreview() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button tone="primary" leadingIcon={<GalleryHorizontalEnd size={14} />} onClick={() => setOpen(true)}>
        Open dialog
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent onClose={() => setOpen(false)} dataTestId="nimi-tester-recipe-dialog">
          <DialogHeader>
            <DialogTitle>Runtime admission check</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="recipe-dialog-copy">This dialog is rendered by kit primitives and does not bypass Runtime or SDK admission.</p>
          </DialogBody>
          <DialogFooter className="recipe-dialog-footer">
            <Button tone="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button tone="primary" onClick={() => setOpen(false)}>Acknowledge</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ScrollAreaPreview() {
  const rows = Array.from({ length: 9 }, (_, index) => ({
    id: `trace-${index + 1}`,
    label: `Trace ${index + 1}`,
    status: index % 3 === 0 ? 'typed unavailable' : index % 3 === 1 ? 'queued' : 'ready',
  }));
  return (
    <ScrollArea className="recipe-scroll-area" viewportClassName="recipe-scroll-area__viewport" contentClassName="recipe-scroll-list">
      {rows.map((row) => (
        <div key={row.id} className="recipe-scroll-row">
          <MessageSquare size={13} />
          <span>{row.label}</span>
          <StatusBadge tone={row.status === 'ready' ? 'success' : row.status === 'queued' ? 'info' : 'warning'}>{row.status}</StatusBadge>
        </div>
      ))}
    </ScrollArea>
  );
}

const surfaceScenarios: SurfaceScenario[] = [
  {
    id: 'ai-request-panel',
    title: 'AI request panel',
    workflow: 'App Lab capability run',
    icon: Sparkles,
    intent: 'Collect a prompt, capability route, and typed readiness before a runtime-backed AI call.',
    primitives: ['Surface', 'FieldShell', 'TextareaField', 'SelectField', 'StatusBadge', 'Button'],
    states: ['ready', 'loading', 'blocked', 'unavailable'],
    defaultState: 'blocked',
    steps: ['Surface shell', 'FieldShell input', 'Capability selector', 'Action row', 'Readiness message'],
    imports: [
      'Surface, FieldShell, TextareaField from @nimiplatform/kit/ui',
      'SelectField, StatusBadge, Button from @nimiplatform/kit/ui',
    ],
    boundaries: [
      'Use typed SDK methods only; never import runtime/internal paths.',
      'No app-local REST or provider bypass from the request panel.',
      'Show blocked or unavailable states instead of claiming a runtime result.',
    ],
    workflowLinks: [
      { label: 'Open App Lab', section: 'app-lab', note: 'Run the capability from the real App Lab lane.' },
      { label: 'Open AI Capabilities', section: 'ai-capabilities', note: 'Inspect SDK admission and route readiness.' },
    ],
    families: ['inputs', 'actions', 'feedback', 'surfaces'],
  },
  {
    id: 'runtime-result-surface',
    title: 'Runtime result surface',
    workflow: 'AI Capabilities result',
    icon: TerminalSquare,
    intent: 'Render runtime output, empty state, or a typed blocker without inventing execution proof.',
    primitives: ['Surface', 'StatusBadge', 'LoadingSkeleton', 'EmptyState', 'IconButton'],
    states: ['ready', 'loading', 'empty', 'blocked'],
    defaultState: 'empty',
    steps: ['Result shell', 'Status header', 'Output viewport', 'Copy action', 'Typed empty or blocker state'],
    imports: [
      'Surface, StatusBadge, LoadingSkeleton from @nimiplatform/kit/ui',
      'EmptyState, IconButton from @nimiplatform/kit/ui',
    ],
    boundaries: [
      'Render only SDK-returned content or a typed local state.',
      'Do not fabricate success or artifacts for a pending run.',
      'Keep copy actions scoped to visible result text.',
    ],
    workflowLinks: [
      { label: 'Open AI Capabilities', section: 'ai-capabilities', note: 'Run one admitted SDK lane.' },
      { label: 'Open Runs', section: 'runs', note: 'Review persisted run history after a real run.' },
    ],
    families: ['surfaces', 'states', 'feedback', 'actions'],
  },
  {
    id: 'sdk-blocker-state',
    title: 'SDK blocker state',
    workflow: 'Boundary Checks',
    icon: AlertTriangle,
    intent: 'Explain missing SDK or runtime admission with a direct action and clear fail-closed copy.',
    primitives: ['InlineAlert', 'StatusBadge', 'Button', 'Surface'],
    states: ['blocked', 'unavailable', 'ready'],
    defaultState: 'blocked',
    steps: ['Alert shell', 'Typed reason', 'Boundary badge', 'Review action'],
    imports: ['InlineAlert, StatusBadge, Button, Surface from @nimiplatform/kit/ui'],
    boundaries: [
      'Name the missing public SDK method or admission gap.',
      'No Desktop private imports to reach around SDK admission.',
      'No fabricated success after a blocker is observed.',
    ],
    workflowLinks: [
      { label: 'Open Boundary Checks', section: 'boundary-checks', note: 'Inspect strict boundary status.' },
      { label: 'Open Runtime Trace', section: 'runtime-trace', note: 'Review runtime projection evidence.' },
    ],
    families: ['feedback', 'states', 'actions'],
  },
  {
    id: 'evidence-action-row',
    title: 'Evidence action row',
    workflow: 'Capture evidence',
    icon: ClipboardCheck,
    intent: 'Gate evidence capture on a real request, result, and trace record.',
    primitives: ['Surface', 'Button', 'StatusBadge', 'ActionMenu', 'IconButton'],
    states: ['ready', 'loading', 'blocked', 'empty'],
    defaultState: 'empty',
    steps: ['Evidence summary', 'Capture button', 'Run linkage', 'Overflow actions'],
    imports: ['Surface, Button, StatusBadge, ActionMenu, IconButton from @nimiplatform/kit/ui'],
    boundaries: [
      'Capture only available request, result, and trace records.',
      'Do not write local evidence for a run that never happened.',
      'Keep artifact links bound to persisted run history.',
    ],
    workflowLinks: [
      { label: 'Open App Lab', section: 'app-lab', note: 'Produce the run before capture.' },
      { label: 'Open Artifacts', section: 'artifacts', note: 'Inspect captured outputs.' },
    ],
    families: ['actions', 'feedback', 'surfaces', 'overlays'],
  },
  {
    id: 'settings-preference',
    title: 'Settings preference',
    workflow: 'Developer settings',
    icon: Settings,
    intent: 'Persist app-owned preferences without mutating runtime, provider, or Desktop authority.',
    primitives: ['Surface', 'Toggle', 'Checkbox', 'Slider', 'SegmentedControl'],
    states: ['ready', 'local-fixture', 'unavailable'],
    defaultState: 'ready',
    steps: ['Preference shell', 'Boolean setting', 'Guardrail checkbox', 'Numeric control', 'Local save state'],
    imports: ['Surface, Toggle, Checkbox, Slider, SegmentedControl from @nimiplatform/kit/ui'],
    boundaries: [
      'Preferences are app-owned local state unless the SDK exposes a write.',
      'No provider/model hardcoding in defaults.',
      'Unavailable runtime settings must stay visibly unavailable.',
    ],
    workflowLinks: [
      { label: 'Open Settings', section: 'settings', note: 'Review local developer controls.' },
      { label: 'Open App Lab', section: 'app-lab', note: 'Return to the active runtime surface.' },
    ],
    families: ['toggles', 'inputs', 'feedback', 'surfaces'],
  },
  {
    id: 'artifact-gallery',
    title: 'Artifact gallery',
    workflow: 'Runs and artifacts',
    icon: GalleryHorizontalEnd,
    intent: 'Browse persisted artifacts while making empty and unavailable states explicit.',
    primitives: ['Surface', 'ScrollArea', 'EmptyState', 'StatusBadge', 'Button'],
    states: ['empty', 'loading', 'ready', 'unavailable'],
    defaultState: 'empty',
    steps: ['Gallery shell', 'Artifact source status', 'Scrollable index', 'Empty fallback', 'Open artifact action'],
    imports: ['Surface, ScrollArea, EmptyState, StatusBadge, Button from @nimiplatform/kit/ui'],
    boundaries: [
      'List only artifacts linked to persisted run records.',
      'Do not create sample media to fill the gallery.',
      'Keep unavailable media capabilities separate from empty history.',
    ],
    workflowLinks: [
      { label: 'Open Artifacts', section: 'artifacts', note: 'Review captured artifact records.' },
      { label: 'Open Runs', section: 'runs', note: 'Trace each artifact to a run.' },
    ],
    families: ['surfaces', 'states', 'actions', 'feedback'],
  },
  {
    id: 'runtime-trace-inspector',
    title: 'Runtime trace inspector',
    workflow: 'Runtime trace',
    icon: FileSearch,
    intent: 'Inspect transport, SDK admission, and evidence linkage as typed trace facts.',
    primitives: ['Surface', 'ScrollArea', 'StatusBadge', 'InlineAlert', 'ActionMenu'],
    states: ['ready', 'loading', 'empty', 'blocked'],
    defaultState: 'empty',
    steps: ['Trace shell', 'Transport badges', 'Scrollable events', 'Boundary alert', 'Trace actions'],
    imports: ['Surface, ScrollArea, StatusBadge, InlineAlert, ActionMenu from @nimiplatform/kit/ui'],
    boundaries: [
      'Trace rows must come from runtime or local run history callbacks.',
      'No app-owned transport fallback outside the SDK surface.',
      'Unavailable trace capture is a valid terminal state.',
    ],
    workflowLinks: [
      { label: 'Open Runtime Trace', section: 'runtime-trace', note: 'Inspect projection and trace evidence.' },
      { label: 'Open Boundary Checks', section: 'boundary-checks', note: 'Verify import and transport boundaries.' },
    ],
    families: ['surfaces', 'feedback', 'states', 'overlays'],
  },
];

function stateTone(state: RecipeState): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (state === 'ready') return 'success';
  if (state === 'loading' || state === 'local-fixture') return 'info';
  if (state === 'blocked' || state === 'unavailable') return 'warning';
  return 'neutral';
}

function stateLabel(state: RecipeState) {
  return state.replace('-', ' ');
}

function RecipeScenarioPreview({ scenario, state }: { scenario: SurfaceScenario; state: RecipeState }) {
  if (scenario.id === 'ai-request-panel') return <AiRequestPanelPreview state={state} />;
  if (scenario.id === 'runtime-result-surface') return <RuntimeResultSurfacePreview state={state} />;
  if (scenario.id === 'sdk-blocker-state') return <SdkBlockerPreview state={state} />;
  if (scenario.id === 'evidence-action-row') return <EvidenceActionPreview state={state} />;
  if (scenario.id === 'settings-preference') return <SettingsPreferencePreview state={state} />;
  if (scenario.id === 'artifact-gallery') return <ArtifactGalleryPreview state={state} />;
  return <RuntimeTracePreview state={state} />;
}

function AiRequestPanelPreview({ state }: { state: RecipeState }) {
  const loading = state === 'loading';
  const blocked = state === 'blocked' || state === 'unavailable';
  return (
    <Surface className="scenario-preview-surface" material="glass-thin" tone="card" elevation="base">
      <div className="scenario-preview-head">
        <div>
          <p className="eyebrow">Capability request</p>
          <strong>Text generation</strong>
        </div>
        <StatusBadge tone={stateTone(state)} shape="dot">{stateLabel(state)}</StatusBadge>
      </div>
      <FieldShell label="Prompt input" description="App-owned draft; runtime result appears only after an admitted SDK call.">
        <TextareaField rows={4} defaultValue="Write a concise acceptance note for a runtime-backed Nimi App." />
      </FieldShell>
      <div className="scenario-inline-grid">
        <FieldShell label="Capability">
          <SelectField
            defaultValue="runtime.ai.text.generate"
            aria-label="Capability"
            options={[
              { value: 'runtime.ai.text.generate', label: 'Text generate' },
              { value: 'runtime.ai.text.stream', label: 'Chat stream' },
            ]}
          />
        </FieldShell>
        <FieldShell label="Mode">
          <SegmentedControl
            items={[
              { value: 'single', label: 'Single' },
              { value: 'stream', label: 'Stream' },
            ]}
            value="single"
            onValueChange={() => undefined}
            ariaLabel="Request mode"
            size="sm"
          />
        </FieldShell>
      </div>
      {blocked ? (
        <InlineAlert tone="warning" icon={<AlertTriangle size={14} />}>
          <div className="runtime-alert-copy">
            <strong>Runtime unavailable</strong>
            <span>Render the typed blocker and keep the run action disabled until SDK admission is available.</span>
          </div>
        </InlineAlert>
      ) : null}
      <div className="scenario-action-row">
        <Button tone="primary" leadingIcon={<Play size={14} />} loading={loading} disabled={blocked}>
          Run with Runtime
        </Button>
        <Button tone="secondary" leadingIcon={<RefreshCw size={14} />}>Refresh readiness</Button>
      </div>
    </Surface>
  );
}

function RuntimeResultSurfacePreview({ state }: { state: RecipeState }) {
  const loading = state === 'loading';
  const blocked = state === 'blocked';
  return (
    <Surface className="scenario-preview-surface" material="glass-thin" tone="card" elevation="base">
      <div className="scenario-preview-head">
        <div>
          <p className="eyebrow">Runtime result</p>
          <strong>Result surface</strong>
        </div>
        <IconButton aria-label="Copy visible result" icon={<Copy size={14} />} disabled={state !== 'ready'} />
      </div>
      <div className="scenario-console">
        {loading ? <LoadingSkeleton lines={4} /> : null}
        {state === 'empty' ? (
          <EmptyState
            icon={<TerminalSquare size={18} />}
            title="No runtime result yet"
            description="Run an admitted capability before this surface shows output."
          />
        ) : null}
        {blocked ? (
          <InlineAlert tone="warning" icon={<AlertTriangle size={14} />}>
            <div className="runtime-alert-copy">
              <strong>Result blocked</strong>
              <span>The SDK reported a typed unavailable state; no output is rendered.</span>
            </div>
          </InlineAlert>
        ) : null}
        {state === 'ready' ? (
          <div className="scenario-console__ready">
            <StatusBadge tone="success" shape="dot">ready for SDK result</StatusBadge>
            <span>Bind this viewport to the real runtime result payload.</span>
          </div>
        ) : null}
      </div>
    </Surface>
  );
}

function SdkBlockerPreview({ state }: { state: RecipeState }) {
  const ready = state === 'ready';
  return (
    <Surface className="scenario-preview-surface" material="glass-thin" tone="card" elevation="base">
      <InlineAlert tone={ready ? 'info' : 'warning'} icon={ready ? <ShieldCheck size={14} /> : <AlertTriangle size={14} />}>
        <div className="runtime-alert-copy">
          <strong>{ready ? 'SDK method admitted' : 'SDK method unavailable'}</strong>
          <span>{ready ? 'The public kit surface can render the action safely.' : 'Show the typed reason and keep runtime execution closed.'}</span>
        </div>
      </InlineAlert>
      <div className="scenario-rule-stack">
        <StatusBadge tone={ready ? 'success' : 'warning'} shape="dot">{ready ? 'admitted' : stateLabel(state)}</StatusBadge>
        <span>runtime.ai.text.generate through public SDK only</span>
      </div>
      <Button tone="secondary" leadingIcon={<ShieldCheck size={14} />}>Review boundary status</Button>
    </Surface>
  );
}

function EvidenceActionPreview({ state }: { state: RecipeState }) {
  const canCapture = state === 'ready';
  return (
    <Surface className="scenario-preview-surface scenario-preview-surface--compact" material="glass-thin" tone="card" elevation="base">
      <div className="scenario-preview-head">
        <div>
          <p className="eyebrow">Evidence action</p>
          <strong>{canCapture ? 'Run record available' : 'No complete run record'}</strong>
        </div>
        <StatusBadge tone={stateTone(state)} shape="dot">{stateLabel(state)}</StatusBadge>
      </div>
      <div className="scenario-metric-row">
        <span>request</span>
        <StatusBadge tone={canCapture ? 'success' : 'neutral'}>{canCapture ? 'available' : 'pending'}</StatusBadge>
        <span>result</span>
        <StatusBadge tone={canCapture ? 'success' : 'neutral'}>{canCapture ? 'available' : 'pending'}</StatusBadge>
        <span>trace</span>
        <StatusBadge tone={canCapture ? 'success' : 'neutral'}>{canCapture ? 'available' : 'pending'}</StatusBadge>
      </div>
      <div className="scenario-action-row">
        <Button tone="primary" leadingIcon={<ClipboardCheck size={14} />} disabled={!canCapture} loading={state === 'loading'}>
          Capture evidence
        </Button>
        <ActionMenu
          ariaLabel="Evidence actions"
          items={[
            { id: 'runs', label: 'Open run history', icon: <TerminalSquare size={13} /> },
            { id: 'artifacts', label: 'Open artifacts', icon: <Boxes size={13} /> },
          ]}
        />
      </div>
    </Surface>
  );
}

function SettingsPreferencePreview({ state }: { state: RecipeState }) {
  return (
    <Surface className="scenario-preview-surface" material="glass-thin" tone="card" elevation="base">
      <div className="scenario-preview-head">
        <div>
          <p className="eyebrow">Developer preference</p>
          <strong>Runtime guardrails</strong>
        </div>
        <StatusBadge tone={stateTone(state)} shape="dot">{stateLabel(state)}</StatusBadge>
      </div>
      <div className="scenario-setting-row">
        <span>Strict boundary mode</span>
        <Toggle checked={state !== 'unavailable'} onChange={() => undefined} disabled={state === 'unavailable'} />
      </div>
      <Checkbox checked label="Require typed SDK admission before run actions" onChange={() => undefined} />
      <FieldShell label="Evidence retention">
        <SegmentedControl
          items={[
            { value: 'local', label: 'Local' },
            { value: 'manual', label: 'Manual' },
          ]}
          value="local"
          onValueChange={() => undefined}
          ariaLabel="Evidence retention"
          size="sm"
        />
      </FieldShell>
    </Surface>
  );
}

function ArtifactGalleryPreview({ state }: { state: RecipeState }) {
  const loading = state === 'loading';
  const ready = state === 'ready';
  return (
    <Surface className="scenario-preview-surface" material="glass-thin" tone="card" elevation="base">
      <div className="scenario-preview-head">
        <div>
          <p className="eyebrow">Artifacts</p>
          <strong>Captured media index</strong>
        </div>
        <StatusBadge tone={stateTone(state)} shape="dot">{stateLabel(state)}</StatusBadge>
      </div>
      {loading ? <LoadingSkeleton lines={5} /> : null}
      {!loading && !ready ? (
        <EmptyState
          icon={<GalleryHorizontalEnd size={18} />}
          title={state === 'unavailable' ? 'Artifact surface unavailable' : 'No artifacts captured'}
          description={state === 'unavailable' ? 'Keep media capabilities visibly unavailable.' : 'Run and capture a real artifact before listing media.'}
        />
      ) : null}
      {ready ? (
        <div className="scenario-record-slot">
          <StatusBadge tone="success" shape="dot">record source ready</StatusBadge>
          <span>Render rows from persisted artifact records only.</span>
          <Button size="sm" tone="secondary" leadingIcon={<Boxes size={13} />}>Open artifact record</Button>
        </div>
      ) : null}
    </Surface>
  );
}

function RuntimeTracePreview({ state }: { state: RecipeState }) {
  const loading = state === 'loading';
  return (
    <Surface className="scenario-preview-surface" material="glass-thin" tone="card" elevation="base">
      <div className="scenario-preview-head">
        <div>
          <p className="eyebrow">Trace inspector</p>
          <strong>Runtime projection</strong>
        </div>
        <StatusBadge tone={stateTone(state)} shape="dot">{stateLabel(state)}</StatusBadge>
      </div>
      {loading ? <LoadingSkeleton lines={4} /> : (
        <ScrollArea className="scenario-artifact-list" viewportClassName="recipe-scroll-area__viewport" contentClassName="recipe-scroll-list">
          {[
            ['transport', state === 'blocked' ? 'blocked' : 'typed status'],
            ['sdk admission', state === 'empty' ? 'no record' : 'checked'],
            ['artifact link', state === 'ready' ? 'available' : 'not captured'],
          ].map(([label, status]) => (
            <div key={label} className="recipe-scroll-row">
              <MessageSquare size={13} />
              <span>{label}</span>
              <StatusBadge tone={status === 'blocked' ? 'warning' : status === 'available' ? 'success' : 'neutral'}>{status}</StatusBadge>
            </div>
          ))}
        </ScrollArea>
      )}
    </Surface>
  );
}

function PrimitiveIndexStrip({
  activeFamilyId,
  onSelectFamily,
}: {
  activeFamilyId: FamilyId;
  onSelectFamily: (family: FamilyId) => void;
}) {
  const family = families.find((item) => item.id === activeFamilyId) || families[0];
  const familyRecipes = recipes[family.id] || [];
  return (
    <Surface className="primitive-index" material="glass-thin" tone="panel" elevation="base">
      <div className="primitive-index__families" aria-label="Primitive families">
        {families.map((item) => {
          const Icon = item.icon;
          const active = item.id === activeFamilyId;
          return (
            <button
              key={item.id}
              type="button"
              className={active ? 'primitive-index__family primitive-index__family--active' : 'primitive-index__family'}
              onClick={() => onSelectFamily(item.id)}
            >
              <Icon size={13} aria-hidden="true" />
              <span>{item.label}</span>
              <strong>{recipes[item.id]?.length || 0}</strong>
            </button>
          );
        })}
      </div>
      <div className="primitive-index__list">
        <p className="eyebrow">{family.label} primitives</p>
        <div>
          {familyRecipes.map((recipe) => (
            <span key={recipe.id} className="primitive-index__pill">{recipe.name}</span>
          ))}
        </div>
      </div>
    </Surface>
  );
}

type KitComponentGalleryProps = {
  onOpenSection?: (section: WorkbenchSectionId) => void;
};

export function KitComponentGallery({ onOpenSection }: KitComponentGalleryProps) {
  const [scenarioId, setScenarioId] = useState(surfaceScenarios[0].id);
  const [variant, setVariant] = useState<RecipeState>(surfaceScenarios[0].defaultState);
  const [familyId, setFamilyId] = useState<FamilyId>(surfaceScenarios[0].families[0]);

  const activeScenario = surfaceScenarios.find((scenario) => scenario.id === scenarioId) || surfaceScenarios[0];
  const totalRecipes = useMemo(
    () => families.reduce((sum, family) => sum + (recipes[family.id]?.length || 0), 0),
    [],
  );

  function pickScenario(nextScenario: SurfaceScenario) {
    setScenarioId(nextScenario.id);
    setVariant(nextScenario.defaultState);
    setFamilyId(nextScenario.families[0]);
  }

  return (
    <section className="kit-gallery" data-testid="nimi-tester-kit-gallery">
      <header className="section-header section-header--compact">
        <div>
          <p className="eyebrow">UI Recipes</p>
          <h2>Nimi Kit recipes for runtime-backed apps</h2>
          <p>Compose app-owned surfaces from reviewed Kit primitives without crossing Runtime or Desktop boundaries.</p>
        </div>
        <div className="kit-gallery__chips">
          <StatusBadge tone="info" shape="dot">kit public surface</StatusBadge>
          <StatusBadge tone="neutral">{totalRecipes} recipes</StatusBadge>
          <StatusBadge tone="neutral">{families.length} families</StatusBadge>
          <StatusBadge tone="success">no private imports</StatusBadge>
        </div>
      </header>
      <div className="recipe-system">
        <nav className="recipe-system__rail" aria-label="Surface scenarios">
          <div className="recipe-system__rail-head">
            <p className="eyebrow">Surface Scenario Rail</p>
            <StatusBadge tone="neutral">{surfaceScenarios.length} scenarios</StatusBadge>
          </div>
          {surfaceScenarios.map((scenario) => {
            const Icon = scenario.icon;
            const isActive = scenario.id === activeScenario.id;
            return (
              <button
                key={scenario.id}
                type="button"
                className={isActive ? 'recipe-system__scenario recipe-system__scenario--active' : 'recipe-system__scenario'}
                onClick={() => pickScenario(scenario)}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="recipe-system__scenario-icon" aria-hidden="true">
                  <Icon size={14} />
                </span>
                <span className="recipe-system__scenario-text">
                  <strong>{scenario.title}</strong>
                  <span>{scenario.workflow}</span>
                </span>
                <span className="recipe-system__scenario-count">{scenario.primitives.length}</span>
              </button>
            );
          })}
        </nav>
        <article className="recipe-composer" aria-label={`${activeScenario.title} recipe`}>
          <header className="recipe-composer__head">
            <div>
              <p className="eyebrow">Recipe Composer / Preview</p>
              <h3>{activeScenario.title}</h3>
              <p>{activeScenario.intent}</p>
            </div>
            <StatusBadge tone={stateTone(variant)} shape="dot">{stateLabel(variant)}</StatusBadge>
          </header>
          <div className="recipe-composer__states">
            <SegmentedControl
              items={activeScenario.states.map((state) => ({ value: state, label: stateLabel(state) }))}
              value={variant}
              onValueChange={(next) => setVariant(next as RecipeState)}
              ariaLabel="Recipe state variants"
              size="sm"
            />
          </div>
          <div className="recipe-composer__preview">
            <RecipeScenarioPreview scenario={activeScenario} state={variant} />
          </div>
          <section className="recipe-composer__steps" aria-label="Composition steps">
            <div className="recipe-composer__section-head">
              <p className="eyebrow">Composition steps</p>
              <StatusBadge tone="neutral">{activeScenario.primitives.length} primitives</StatusBadge>
            </div>
            <ol>
              {activeScenario.steps.map((step, index) => (
                <li key={step}>
                  <span>{index + 1}</span>
                  <strong>{step}</strong>
                </li>
              ))}
            </ol>
          </section>
        </article>
        <aside className="recipe-contract" aria-label="Contract and imports">
          <div className="recipe-contract__head">
            <p className="eyebrow">Contract & Imports</p>
            <h3>{activeScenario.workflow}</h3>
          </div>
          <section>
            <p className="recipe-contract__label">Allowed imports</p>
            <ul className="recipe-contract__imports">
              {activeScenario.imports.map((line) => (
                <li key={line}><code>{line}</code></li>
              ))}
            </ul>
          </section>
          <section>
            <p className="recipe-contract__label">Boundary rules</p>
            <ul className="recipe-contract__rules">
              {activeScenario.boundaries.map((rule) => (
                <li key={rule}>
                  <ShieldCheck size={13} aria-hidden="true" />
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <p className="recipe-contract__label">Use in workflow</p>
            <div className="recipe-contract__links">
              {activeScenario.workflowLinks.map((link) => (
                <button
                  key={link.section}
                  type="button"
                  className="recipe-contract__link"
                  onClick={() => onOpenSection?.(link.section)}
                >
                  <span>
                    <strong>{link.label}</strong>
                    <small>{link.note}</small>
                  </span>
                  <ArrowRight size={13} aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>
      <PrimitiveIndexStrip activeFamilyId={familyId} onSelectFamily={setFamilyId} />
    </section>
  );
}
