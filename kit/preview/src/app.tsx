import React, { useState } from 'react';
import {
  AmbientBackground,
  Button,
  Checkbox,
  EmptyState,
  IconButton,
  InlineAlert,
  LoadingSkeleton,
  NimiText,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ProgressIndicator,
  SearchField,
  SelectField,
  SegmentedControl,
  Slider,
  StatusBadge,
  Surface,
  TextField,
  TextareaField,
  Toggle,
  OverlayShell,
  type NimiDensity,
  type NimiThemeScheme,
} from '@nimiplatform/kit/ui';

export type PreviewParams = {
  scheme: NimiThemeScheme;
  density: NimiDensity;
  section: string | null;
  overlay: 'dialog' | 'drawer' | 'popover' | null;
};

export function parsePreviewParams(search: URLSearchParams): PreviewParams {
  const scheme = search.get('scheme') === 'dark' ? 'dark' : 'light';
  const densityParam = search.get('density');
  const density: NimiDensity =
    densityParam === 'compact' || densityParam === 'expressive' ? densityParam : 'regular';
  const section = search.get('section');
  const overlayParam = search.get('overlay');
  const overlay =
    overlayParam === 'dialog' || overlayParam === 'drawer' || overlayParam === 'popover'
      ? overlayParam
      : null;
  return { scheme, density, section, overlay };
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section data-preview-section={id} className="flex flex-col gap-4">
      <NimiText role="section-title" as="h2">{title}</NimiText>
      {children}
    </section>
  );
}

function Card({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <Surface tone="card" elevation="base" padding="md" className="flex flex-col gap-3" data-testid={testId}>
      <NimiText role="label" as="h3">{title}</NimiText>
      {children}
    </Surface>
  );
}

function FoundationsSection() {
  const swatches: Array<{ label: string; className: string }> = [
    { label: 'Action primary', className: 'bg-[var(--nimi-action-primary-bg)]' },
    { label: 'Text primary', className: 'bg-[var(--nimi-text-primary)]' },
    { label: 'Text secondary', className: 'bg-[var(--nimi-text-secondary)]' },
    { label: 'Surface canvas', className: 'bg-[var(--nimi-surface-canvas)] border border-[var(--nimi-border-subtle)]' },
    { label: 'Surface card', className: 'bg-[var(--nimi-surface-card)] border border-[var(--nimi-border-subtle)]' },
    { label: 'Status info', className: 'bg-[var(--nimi-status-info-soft-bg)]' },
    { label: 'Status danger', className: 'bg-[var(--nimi-status-danger-soft-bg)]' },
  ];
  return (
    <Section id="foundations" title="Foundations">
      <Card title="Color roles" testId="card-colors">
        <div className="grid grid-cols-3 gap-3">
          {swatches.map((s) => (
            <div key={s.label} className="flex flex-col gap-1">
              <div className={`h-10 rounded-[var(--nimi-radius-sm)] ${s.className}`} />
              <NimiText role="caption">{s.label}</NimiText>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Corner radius">
        <div className="flex gap-4">
          {(['sm', 'md', 'lg', 'xl'] as const).map((r) => (
            <div key={r} className="flex flex-col items-center gap-1">
              <div
                className="h-14 w-14 border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]"
                style={{ borderRadius: `var(--nimi-radius-${r})` }}
              />
              <NimiText role="caption">radius {r}</NimiText>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Materials" testId="card-materials">
        <div className="relative h-40 overflow-hidden rounded-[var(--nimi-radius-md)]">
          <AmbientBackground variant="mesh" className="absolute inset-0" />
          <div className="relative grid h-full grid-cols-4 gap-3 p-3">
            {(['glass-thin', 'glass-regular', 'glass-thick', 'glass-chrome'] as const).map((m) => (
              <Surface key={m} material={m} elevation="raised" padding="sm" data-testid={`material-${m}`}>
                <NimiText role="caption">{m}</NimiText>
              </Surface>
            ))}
          </div>
        </div>
      </Card>
    </Section>
  );
}

function TypographySection() {
  return (
    <Section id="typography" title="Typography">
      <Card title="Roles" testId="card-typography">
        <NimiText role="page-title" data-testid="type-page-title">Page title</NimiText>
        <NimiText role="section-title">Section title</NimiText>
        <NimiText role="card-title">Card title</NimiText>
        <NimiText role="body" data-testid="type-body">Body copy for product surfaces and settings flows.</NimiText>
        <NimiText role="helper">Helper text under form controls.</NimiText>
        <NimiText role="label">Field label</NimiText>
        <NimiText role="caption">Caption text</NimiText>
      </Card>
      <Card title="CJK profile (lang=zh)">
        <div lang="zh">
          <NimiText role="page-title">运行时配置</NimiText>
          <NimiText role="body" data-testid="type-body-zh">
            在受管表面上使用中性画布与克制的材质层级，反馈需要即时但安静。
          </NimiText>
        </div>
      </Card>
      <Card title="Expressive boundary (hero)">
        <NimiText role="hero-title" data-testid="type-hero-title">Nimi Realm</NimiText>
        <NimiText role="helper">hero-title is admitted only inside expressive density boundaries.</NimiText>
      </Card>
    </Section>
  );
}

function ActionsSection() {
  const [segment, setSegment] = useState('day');
  return (
    <Section id="actions" title="Actions">
      <Card title="Button / IconButton" testId="card-actions">
        <div className="flex flex-wrap items-center gap-3">
          <Button tone="primary" data-testid="btn-primary">Primary</Button>
          <Button tone="secondary" data-testid="btn-secondary">Secondary</Button>
          <Button tone="ghost" data-testid="btn-ghost">Ghost</Button>
          <Button tone="danger" data-testid="btn-danger">Danger</Button>
          <IconButton aria-label="refresh" data-testid="btn-icon" icon={<span>⟳</span>} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
          <Button disabled>Disabled</Button>
        </div>
        {/* P-DESIGN-028: expressive escape hatch inside a compact region
            restores foundation sizing for the subtree. */}
        <div data-nimi-density="expressive" className="flex items-center gap-3 rounded-[var(--nimi-radius-md)] border border-dashed border-[var(--nimi-border-strong)] p-3">
          <Button tone="secondary" data-testid="btn-expressive">Expressive boundary</Button>
          <NimiText role="helper">nested expressive region restores foundation sizing</NimiText>
        </div>
      </Card>
      <Card title="Segmented">
        <SegmentedControl
          ariaLabel="range"
          value={segment}
          onValueChange={setSegment}
          items={[
            { value: 'day', label: 'Day' },
            { value: 'week', label: 'Week' },
            { value: 'month', label: 'Month' },
          ]}
        />
      </Card>
    </Section>
  );
}

function InputsSection() {
  const [on, setOn] = useState(true);
  const [checked, setChecked] = useState(true);
  const [slider, setSlider] = useState(40);
  return (
    <Section id="inputs" title="Inputs">
      <Card title="Fields">
        <TextField placeholder="Project name" aria-label="project name" />
        <SearchField placeholder="Search" aria-label="search" />
        <SelectField
          aria-label="runtime route"
          data-testid="select-route"
          placeholder="Select route"
          options={[
            { value: 'text.generate', label: 'text.generate' },
            { value: 'image.generate', label: 'image.generate' },
            { value: 'voice.synthesize', label: 'voice.synthesize' },
          ]}
        />
        <TextareaField placeholder="Notes" aria-label="notes" />
      </Card>
      <Card title="Selection">
        <div className="flex items-center gap-3">
          <Toggle checked={on} onChange={setOn} />
          <NimiText role="body">Runtime bridge {on ? 'enabled' : 'disabled'}</NimiText>
        </div>
        <div className="flex items-center gap-3">
          <Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)} aria-label="confirm" />
          <NimiText role="body">Confirm before destructive actions</NimiText>
        </div>
        <Slider value={slider} onChange={(e) => setSlider(Number(e.target.value))} aria-label="volume" showValue />
      </Card>
    </Section>
  );
}

function FeedbackSection() {
  return (
    <Section id="feedback" title="Feedback & status">
      <Card title="Inline alert">
        <InlineAlert tone="info">Runtime check scheduled.</InlineAlert>
        <InlineAlert tone="warning">Local model cache is almost full.</InlineAlert>
        <InlineAlert tone="danger">Bridge connection lost.</InlineAlert>
        <InlineAlert tone="success">Export finished.</InlineAlert>
      </Card>
      <Card title="Status badge">
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone="neutral">Idle</StatusBadge>
          <StatusBadge tone="success">Online</StatusBadge>
          <StatusBadge tone="warning">Degraded</StatusBadge>
          <StatusBadge tone="danger">Blocked</StatusBadge>
          <StatusBadge tone="info">Syncing</StatusBadge>
        </div>
      </Card>
      <Card title="Progress / skeleton / empty">
        <ProgressIndicator value={62} aria-label="progress" />
        <LoadingSkeleton className="h-4 w-2/3" />
        <EmptyState title="No runs yet" description="Start a generation to see history here." />
      </Card>
    </Section>
  );
}

function OverlaysSection({ forcedOverlay }: { forcedOverlay: PreviewParams['overlay'] }) {
  const [open, setOpen] = useState<'dialog' | 'drawer' | null>(null);
  const active = forcedOverlay ?? open;
  return (
    <Section id="overlays" title="Overlays">
      <Card title="OverlayShell">
        <div className="flex flex-wrap gap-3">
          <Button tone="secondary" data-testid="open-dialog" onClick={() => setOpen('dialog')}>Open dialog</Button>
          <Button tone="secondary" data-testid="open-drawer" onClick={() => setOpen('drawer')}>Open drawer</Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button tone="secondary" data-testid="open-popover">Open popover</Button>
            </PopoverTrigger>
            <PopoverContent data-testid="popover-panel" side="bottom">
              <NimiText role="label">Route detail</NimiText>
              <NimiText role="helper">Local runtime · text.generate</NimiText>
            </PopoverContent>
          </Popover>
        </div>
      </Card>
      <OverlayShell
        open={active === 'dialog'}
        kind="dialog"
        title="SDK projection detail"
        description="Overlay chrome comes from Kit UI."
        onClose={() => setOpen(null)}
        footer={<Button tone="primary" onClick={() => setOpen(null)}>Done</Button>}
      >
        <NimiText role="body">Consumer-owned content area with kit-owned spacing and structure.</NimiText>
      </OverlayShell>
      <OverlayShell
        open={active === 'drawer'}
        kind="drawer"
        title="SDK projection detail"
        onClose={() => setOpen(null)}
        footer={<Button tone="primary" onClick={() => setOpen(null)}>Done</Button>}
      >
        <NimiText role="body">Drawer panels settle with a spring along their own edge axis.</NimiText>
      </OverlayShell>
    </Section>
  );
}

const SECTIONS: Array<{ id: string; title: string }> = [
  { id: 'foundations', title: 'Foundations' },
  { id: 'typography', title: 'Typography' },
  { id: 'actions', title: 'Actions' },
  { id: 'inputs', title: 'Inputs' },
  { id: 'overlays', title: 'Overlays' },
  { id: 'feedback', title: 'Feedback' },
];

export function PreviewApp({ params }: { params: PreviewParams }) {
  const showSection = (id: string) => !params.section || params.section === id;
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 p-8" data-preview-root>
      <header className="flex flex-col gap-1">
        <NimiText role="page-title">Nimi Kit Preview</NimiText>
        <NimiText role="helper">
          scheme={params.scheme} · density={params.density}
          {params.section ? ` · section=${params.section}` : ''}
        </NimiText>
      </header>
      {showSection('foundations') ? <FoundationsSection /> : null}
      {showSection('typography') ? <TypographySection /> : null}
      {showSection('actions') ? <ActionsSection /> : null}
      {showSection('inputs') ? <InputsSection /> : null}
      {showSection('overlays') ? <OverlaysSection forcedOverlay={params.overlay} /> : null}
      {showSection('feedback') ? <FeedbackSection /> : null}
      <footer className="pt-4">
        <NimiText role="caption">{SECTIONS.length} sections · governed by canonical platform authority</NimiText>
      </footer>
    </div>
  );
}
