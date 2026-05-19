import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test } from 'vitest';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  FieldShell,
  IconButton,
  InlineAlert,
  LoadingSkeleton,
  NimiThemeProvider,
  NimiTabs,
  NimiText,
  NumberStepper,
  OverlayShell,
  Popover,
  PopoverContent,
  ProgressIndicator,
  SearchField,
  SelectField,
  SegmentedControl,
  SidebarAffordanceBadge,
  SidebarAffordanceChevron,
  SidebarAffordanceStatusDot,
  SidebarHeader,
  SettingsCard,
  SettingsPageShell,
  SettingsSectionTitle,
  SidebarItem,
  SidebarResizeHandle,
  SidebarSearch,
  SidebarSection,
  SidebarShell,
  StatusBadge,
  Surface,
  TextField,
  TextareaField,
  Toggle,
  Tooltip,
  TooltipProvider,
  ActionMenu,
  Slider,
  BackLink,
  PageDetailLayout,
  Timeline,
  TimelineDivider,
  TimelineGroup,
  cn,
  downgradeSurfaceMaterial,
} from '../src/index.js';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const hasClass = (html: string, name: string) =>
  new RegExp(`class="[^"]*\\b${name}\\b[^"]*"`, 'u').test(html);

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
      await flush();
    });
  }
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = '';
});

test('shared primitives render sidebar structure', () => {
  const html = renderToStaticMarkup(
    <SidebarShell data-testid="sidebar">
      <SidebarHeader title="Main" />
      <SidebarSearch value="" onChange={() => {}} placeholder="Search" />
      <SidebarSection label="Workspace">
        <SidebarItem
          kind="nav-row"
          active
          label="Settings"
          description="Controls"
          trailing={<SidebarAffordanceChevron />}
        />
        <SidebarItem
          kind="entity-row"
          label="Nimi"
          trailing={<SidebarAffordanceStatusDot />}
        />
        <SidebarItem
          kind="category-row"
          label="Drafts"
          trailing={<SidebarAffordanceBadge>2</SidebarAffordanceBadge>}
        />
      </SidebarSection>
      <SidebarResizeHandle ariaLabel="Resize sidebar" onMouseDown={() => {}} />
    </SidebarShell>,
  );

  expect(html).toMatch(/aside/);
  expect(html).toMatch(/Settings/);
  expect(html).toMatch(/button/);
  expect(hasClass(html, 'nimi-sidebar-shell')).toBe(true);
  expect(hasClass(html, 'nimi-sidebar-header')).toBe(true);
  expect(hasClass(html, 'nimi-sidebar-search-row')).toBe(true);
  expect(hasClass(html, 'nimi-sidebar-search')).toBe(true);
  expect(hasClass(html, 'nimi-sidebar-search__field')).toBe(true);
  expect(hasClass(html, 'nimi-sidebar-section')).toBe(true);
  expect(hasClass(html, 'nimi-sidebar-section-label')).toBe(true);
  expect(hasClass(html, 'nimi-sidebar-item')).toBe(true);
  expect(hasClass(html, 'nimi-sidebar-item--nav-row')).toBe(true);
  expect(hasClass(html, 'nimi-sidebar-item--entity-row')).toBe(true);
  expect(hasClass(html, 'nimi-sidebar-item--category-row')).toBe(true);
  expect(hasClass(html, 'nimi-sidebar-item--active')).toBe(true);
  expect(hasClass(html, 'nimi-sidebar-item__title')).toBe(true);
  expect(hasClass(html, 'nimi-sidebar-item__description')).toBe(true);
  expect(hasClass(html, 'nimi-sidebar-affordance')).toBe(true);
  expect(hasClass(html, 'nimi-sidebar-affordance--badge')).toBe(true);
  expect(hasClass(html, 'nimi-sidebar-affordance--chevron')).toBe(true);
  expect(hasClass(html, 'nimi-sidebar-affordance--status-dot')).toBe(true);
  expect(hasClass(html, 'nimi-sidebar-resize-handle')).toBe(true);
});

test('surface, button, field, and status primitives render', () => {
  const html = renderToStaticMarkup(
    <div>
      <Surface tone="card" elevation="floating" material="glass-thick" transparency="reduced" interactive active>card</Surface>
      <SettingsCard>settings-card</SettingsCard>
      <SettingsPageShell contentClassName="px-2 py-2">
        <SettingsSectionTitle description="Shared settings section">Preferences</SettingsSectionTitle>
      </SettingsPageShell>
      <Button tone="primary" loading active leadingIcon={<span />} trailingIcon={<span />}>save</Button>
      <IconButton tone="ghost" size="sm" active icon={<span />} aria-label="Icon action" />
      <SearchField placeholder="Search" />
      <StatusBadge tone="success" shape="dot">ready</StatusBadge>
    </div>,
  );

  expect(html).toMatch(/card/);
  expect(html).toMatch(/settings-card/);
  expect(html).toMatch(/Preferences/);
  expect(html).toMatch(/Shared settings section/);
  expect(html).toMatch(/save/);
  expect(html).toMatch(/Search/);
  expect(html).toMatch(/ready/);
  expect(hasClass(html, 'nimi-surface')).toBe(true);
  expect(hasClass(html, 'nimi-surface--card')).toBe(true);
  expect(hasClass(html, 'nimi-surface--elevation-floating')).toBe(true);
  expect(hasClass(html, 'nimi-surface--interactive')).toBe(true);
  expect(hasClass(html, 'nimi-surface--active')).toBe(true);
  expect(hasClass(html, 'nimi-surface--transparency-reduced')).toBe(true);
  expect(hasClass(html, 'nimi-material-glass-regular')).toBe(true);
  expect(hasClass(html, 'nimi-action')).toBe(true);
  expect(hasClass(html, 'nimi-action--primary')).toBe(true);
  expect(hasClass(html, 'nimi-action--ghost')).toBe(true);
  expect(hasClass(html, 'nimi-action--active')).toBe(true);
  expect(hasClass(html, 'nimi-action--loading')).toBe(true);
  expect(hasClass(html, 'nimi-action--size-sm')).toBe(true);
  expect(hasClass(html, 'nimi-action--size-md')).toBe(true);
  expect(hasClass(html, 'nimi-action--icon')).toBe(true);
  expect(hasClass(html, 'whitespace-nowrap')).toBe(true);
  expect(hasClass(html, 'shrink-0')).toBe(true);
  expect(hasClass(html, 'nimi-action__leading')).toBe(true);
  expect(hasClass(html, 'nimi-action__trailing')).toBe(true);
  expect(hasClass(html, 'nimi-action__icon')).toBe(true);
  expect(hasClass(html, 'nimi-action__spinner')).toBe(true);
  expect(hasClass(html, 'nimi-status-badge')).toBe(true);
  expect(hasClass(html, 'nimi-status-badge--success')).toBe(true);
  expect(hasClass(html, 'nimi-status-badge--dot')).toBe(true);
  expect(hasClass(html, 'nimi-status-badge__dot')).toBe(true);
});

test('shared control and feedback primitives render canonical slots', () => {
  const html = renderToStaticMarkup(
    <div>
      <NimiText role="page-title">AI Runtime</NimiText>
      <NimiText role="section-title">Runtime Load</NimiText>
      <NimiText role="card-title">System Resources</NimiText>
      <NimiText role="helper">Captured metadata</NimiText>
      <SegmentedControl
        ariaLabel="View"
        value="grid"
        onValueChange={() => {}}
        items={[
          { value: 'grid', label: 'Grid', icon: <span /> },
          { value: 'list', label: 'List' },
        ]}
      />
      <NimiTabs
        ariaLabel="Profile tabs"
        value="posts"
        onValueChange={() => {}}
        items={[
          { value: 'posts', label: 'Posts' },
          { value: 'likes', label: 'Likes' },
        ]}
      />
      <Checkbox defaultChecked label="Checked" />
      <Slider defaultValue={60} showValue />
      <NumberStepper value={12} ariaLabel="Count" onValueChange={() => {}} />
      <ProgressIndicator value={62} showValue />
      <InlineAlert tone="success" icon={<span />} action={<button type="button">Dismiss</button>}>Saved</InlineAlert>
      <EmptyState title="No data yet" description="Create something" action={<Button tone="primary">Create</Button>} />
      <LoadingSkeleton lines={3} />
      <ActionMenu
        ariaLabel="Actions"
        items={[
          { id: 'edit', label: 'Edit', icon: <span /> },
          { id: 'delete', label: 'Delete', tone: 'danger' },
        ]}
      />
      <FieldShell label="Name" description="Required" message="Use a stable name" messageTone="danger">
        <SearchField placeholder="Search" />
      </FieldShell>
    </div>,
  );

  expect(hasClass(html, 'nimi-text')).toBe(true);
  expect(hasClass(html, 'nimi-text--page-title')).toBe(true);
  expect(hasClass(html, 'nimi-text--section-title')).toBe(true);
  expect(hasClass(html, 'nimi-text--card-title')).toBe(true);
  expect(hasClass(html, 'nimi-text--helper')).toBe(true);
  expect(hasClass(html, 'nimi-segmented-control')).toBe(true);
  expect(hasClass(html, 'nimi-segmented-control__item')).toBe(true);
  expect(hasClass(html, 'nimi-segmented-control__item--selected')).toBe(true);
  expect(hasClass(html, 'nimi-tabs')).toBe(true);
  expect(hasClass(html, 'nimi-tabs__tab--active')).toBe(true);
  expect(hasClass(html, 'nimi-checkbox')).toBe(true);
  expect(hasClass(html, 'nimi-checkbox__box')).toBe(true);
  expect(hasClass(html, 'nimi-slider')).toBe(true);
  expect(hasClass(html, 'nimi-number-stepper')).toBe(true);
  expect(hasClass(html, 'nimi-progress')).toBe(true);
  expect(hasClass(html, 'nimi-inline-alert')).toBe(true);
  expect(hasClass(html, 'nimi-inline-alert--success')).toBe(true);
  expect(hasClass(html, 'nimi-empty-state')).toBe(true);
  expect(hasClass(html, 'nimi-skeleton')).toBe(true);
  expect(hasClass(html, 'nimi-action-menu')).toBe(true);
  expect(hasClass(html, 'nimi-action-menu__item--danger')).toBe(true);
  expect(hasClass(html, 'nimi-field-shell')).toBe(true);
  expect(html).toMatch(/aria-describedby/);
});

test('surface material transparency downgrade is deterministic', () => {
  expect(downgradeSurfaceMaterial('glass-chrome', 'reduced')).toBe('glass-thick');
  expect(downgradeSurfaceMaterial('glass-thick', 'reduced')).toBe('glass-regular');
  expect(downgradeSurfaceMaterial('glass-regular', 'reduced')).toBe('glass-thin');
  expect(downgradeSurfaceMaterial('glass-thin', 'reduced')).toBe('glass-thin');
  expect(downgradeSurfaceMaterial('glass-chrome', 'solid')).toBe('solid');
});

test('overlay primitives emit canonical overlay slots', async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <div>
        <Dialog open>
          <DialogContent>
            <DialogHeader>Title</DialogHeader>
            <DialogBody>Body</DialogBody>
            <DialogFooter>Footer</DialogFooter>
          </DialogContent>
        </Dialog>
        <OverlayShell open kind="drawer" title="Drawer" footer={<button type="button">Done</button>}>
          Content
        </OverlayShell>
        <Popover open>
          <PopoverContent>Popover</PopoverContent>
        </Popover>
        <TooltipProvider>
          <Tooltip open content="Tip">
            <button type="button">Hover</button>
          </Tooltip>
        </TooltipProvider>
      </div>,
    );
    await flush();
  });

  const html = document.body.innerHTML;
  expect(hasClass(html, 'nimi-overlay-backdrop')).toBe(true);
  expect(hasClass(html, 'nimi-overlay-backdrop--dialog')).toBe(true);
  expect(hasClass(html, 'nimi-overlay-backdrop--drawer')).toBe(true);
  expect(hasClass(html, 'nimi-overlay-panel')).toBe(true);
  expect(hasClass(html, 'nimi-overlay-panel--dialog')).toBe(true);
  expect(hasClass(html, 'nimi-overlay-panel--drawer')).toBe(true);
  expect(hasClass(html, 'nimi-overlay-panel--popover')).toBe(true);
  expect(hasClass(html, 'nimi-overlay-title')).toBe(true);
  expect(hasClass(html, 'nimi-overlay-content')).toBe(true);
  expect(hasClass(html, 'nimi-overlay-footer')).toBe(true);
  expect(hasClass(html, 'nimi-tooltip-layer')).toBe(true);
  expect(hasClass(html, 'nimi-tooltip-bubble')).toBe(true);
});

test('text field danger tone applies danger chrome and auto-sets aria-invalid', async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <div>
        <TextField tone="danger" data-testid="tf-danger" />
        <TextField tone="danger" aria-invalid={false} data-testid="tf-danger-explicit-false" />
        <TextField tone="danger" aria-invalid={true} data-testid="tf-danger-explicit-true" />
      </div>,
    );
    await flush();
  });

  const autoInput = document.querySelector('[data-testid="tf-danger"]') as HTMLInputElement | null;
  expect(autoInput).toBeTruthy();
  expect(autoInput!.getAttribute('aria-invalid')).toBe('true');
  const autoLabel = autoInput!.closest('label') as HTMLLabelElement | null;
  expect(autoLabel).toBeTruthy();
  expect(autoLabel!.className).toMatch(/nimi-field--danger/);
  expect(autoLabel!.className).toMatch(/border-\[var\(--nimi-status-danger\)\]/);
  expect(autoLabel!.className).toMatch(/focus-within:border-\[var\(--nimi-status-danger\)\]/);
  expect(autoLabel!.className).toMatch(/focus-within:ring-\[var\(--nimi-status-danger\)\]/);

  const explicitFalseInput = document.querySelector('[data-testid="tf-danger-explicit-false"]') as HTMLInputElement | null;
  expect(explicitFalseInput).toBeTruthy();
  expect(explicitFalseInput!.getAttribute('aria-invalid')).toBe('false');

  const explicitTrueInput = document.querySelector('[data-testid="tf-danger-explicit-true"]') as HTMLInputElement | null;
  expect(explicitTrueInput).toBeTruthy();
  expect(explicitTrueInput!.getAttribute('aria-invalid')).toBe('true');
});

test('textarea field danger tone applies danger chrome and auto-sets aria-invalid', async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <div>
        <TextareaField tone="danger" data-testid="ta-danger" />
        <TextareaField tone="danger" aria-invalid={false} data-testid="ta-danger-explicit-false" />
      </div>,
    );
    await flush();
  });

  const autoTextarea = document.querySelector('[data-testid="ta-danger"]') as HTMLTextAreaElement | null;
  expect(autoTextarea).toBeTruthy();
  expect(autoTextarea!.getAttribute('aria-invalid')).toBe('true');
  const autoLabel = autoTextarea!.closest('label') as HTMLLabelElement | null;
  expect(autoLabel).toBeTruthy();
  expect(autoLabel!.className).toMatch(/nimi-field--danger/);
  expect(autoLabel!.className).toMatch(/border-\[var\(--nimi-status-danger\)\]/);

  const explicitFalseTextarea = document.querySelector('[data-testid="ta-danger-explicit-false"]') as HTMLTextAreaElement | null;
  expect(explicitFalseTextarea).toBeTruthy();
  expect(explicitFalseTextarea!.getAttribute('aria-invalid')).toBe('false');
});

test('text field non-danger tones preserve pre-existing render (backward-compat)', () => {
  const defaultHtml = renderToStaticMarkup(<TextField />);
  const defaultExplicitHtml = renderToStaticMarkup(<TextField tone="default" />);
  const searchHtml = renderToStaticMarkup(<TextField tone="search" />);
  const quietHtml = renderToStaticMarkup(<TextField tone="quiet" />);

  // None of the non-danger renders should leak the danger tokens or class.
  for (const html of [defaultHtml, defaultExplicitHtml, searchHtml, quietHtml]) {
    expect(html).not.toMatch(/nimi-field--danger/);
    expect(html).not.toMatch(/var\(--nimi-status-danger\)/);
    expect(html).not.toMatch(/aria-invalid="true"/);
  }

  // Default and explicit-default must render identically.
  expect(defaultHtml).toBe(defaultExplicitHtml);

  // Tone-specific classes still appear.
  expect(searchHtml).toMatch(/rounded-\[var\(--nimi-radius-full\)\]/);
  expect(quietHtml).toMatch(/border-transparent/);
  expect(quietHtml).toMatch(/bg-transparent/);
});

test('textarea field non-danger tones preserve pre-existing render (backward-compat)', () => {
  const defaultHtml = renderToStaticMarkup(<TextareaField />);
  const defaultExplicitHtml = renderToStaticMarkup(<TextareaField tone="default" />);
  const quietHtml = renderToStaticMarkup(<TextareaField tone="quiet" />);

  for (const html of [defaultHtml, defaultExplicitHtml, quietHtml]) {
    expect(html).not.toMatch(/nimi-field--danger/);
    expect(html).not.toMatch(/var\(--nimi-status-danger\)/);
    expect(html).not.toMatch(/aria-invalid="true"/);
  }
  expect(defaultHtml).toBe(defaultExplicitHtml);
  expect(quietHtml).toMatch(/border-transparent/);
  expect(quietHtml).toMatch(/bg-transparent/);
});

test('select field ignores empty option values reserved by Radix', () => {
  expect(() => renderToStaticMarkup(
    <SelectField
      value=""
      placeholder="Select a connector"
      options={[
        { value: '', label: 'Invalid empty option' },
        { value: 'connector.openai', label: 'OpenAI' },
      ]}
    />,
  )).not.toThrow();
});

test('toggle primitive renders canonical switch slots and states', () => {
  const html = renderToStaticMarkup(
    <div>
      <Toggle checked onChange={() => {}} />
      <Toggle checked={false} onChange={() => {}} disabled />
    </div>,
  );

  expect(hasClass(html, 'nimi-toggle')).toBe(true);
  expect(hasClass(html, 'nimi-toggle__thumb')).toBe(true);
  expect(html).toMatch(/data-state="checked"/);
  expect(html).toMatch(/data-state="unchecked"/);
  expect(html).toMatch(/disabled=""/);
});

test('confirm dialog uses governed overlay and action primitives', async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <ConfirmDialog
        open
        title="Delete this world?"
        message="This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        pending
        pendingLabel="Deleting"
        onConfirm={() => {}}
        onClose={() => {}}
      />,
    );
    await flush();
  });

  const html = document.body.innerHTML;
  expect(html).toMatch(/Delete this world/);
  expect(html).toMatch(/This action cannot be undone/);
  expect(html).toMatch(/Deleting/);
  expect(hasClass(html, 'nimi-overlay-backdrop')).toBe(true);
  expect(hasClass(html, 'nimi-overlay-panel--dialog')).toBe(true);
  expect(hasClass(html, 'nimi-overlay-title')).toBe(true);
  expect(hasClass(html, 'nimi-overlay-footer')).toBe(true);
  expect(hasClass(html, 'nimi-action--danger')).toBe(true);
});

test('theme provider applies semantic accent packs without app truth', async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <NimiThemeProvider accentPack="nimi-accent" defaultScheme="dark">
        <Surface tone="panel">theme</Surface>
      </NimiThemeProvider>,
    );
    await flush();
  });

  expect(document.documentElement.dataset.nimiScheme).toBe('dark');
  expect(document.documentElement.dataset.nimiAccent).toBe('nimi-accent');
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(document.documentElement.classList.contains('nimi-theme-accent--nimi-accent')).toBe(true);

  await act(async () => {
    root?.render(
      <NimiThemeProvider accentPack="forge-accent" scheme="light">
        <Surface tone="panel">theme</Surface>
      </NimiThemeProvider>,
    );
    await flush();
  });

  expect(document.documentElement.dataset.nimiScheme).toBe('light');
  expect(document.documentElement.dataset.nimiAccent).toBe('forge-accent');
  expect(document.documentElement.classList.contains('dark')).toBe(false);
  expect(document.documentElement.classList.contains('nimi-theme-accent--forge-accent')).toBe(true);
  expect(document.documentElement.classList.contains('nimi-theme-accent--nimi-accent')).toBe(false);
});

test('cn utility merges classes correctly', () => {
  expect(cn('foo', 'bar')).toBe('foo bar');
  expect(cn('p-4', false, null, 'text-sm')).toBe('p-4 text-sm');
  expect(cn('p-4', 'p-6')).toBe('p-6');
});

test('page-detail-layout composes back / title / actions / subnav / before-content slots', () => {
  const html = renderToStaticMarkup(
    <PageDetailLayout
      width="lg"
      title="口腔档案"
      back={
        <BackLink href="/profile" data-testid="back">
          返回档案
        </BackLink>
      }
      actions={<Button tone="primary">添加</Button>}
      subnav={<div data-testid="subnav">tab-nav</div>}
      beforeContent={<div data-testid="before">ai-summary</div>}
    >
      <div data-testid="body">body</div>
    </PageDetailLayout>,
  );

  expect(html).toMatch(/口腔档案/);
  expect(html).toMatch(/返回档案/);
  expect(html).toMatch(/添加/);
  expect(html).toMatch(/tab-nav/);
  expect(html).toMatch(/ai-summary/);
  expect(html).toMatch(/body/);
  expect(hasClass(html, 'nimi-page-detail-layout')).toBe(true);
  expect(hasClass(html, 'nimi-page-detail-layout--width-lg')).toBe(true);
  expect(hasClass(html, 'nimi-page-detail-layout__back-row')).toBe(true);
  expect(hasClass(html, 'nimi-page-detail-layout__header')).toBe(true);
  expect(hasClass(html, 'nimi-page-detail-layout__title')).toBe(true);
  expect(hasClass(html, 'nimi-page-detail-layout__actions')).toBe(true);
  expect(hasClass(html, 'nimi-page-detail-layout__subnav')).toBe(true);
  expect(hasClass(html, 'nimi-page-detail-layout__before-content')).toBe(true);
  expect(hasClass(html, 'nimi-page-detail-layout__body')).toBe(true);
  expect(hasClass(html, 'nimi-back-link')).toBe(true);
  expect(hasClass(html, 'nimi-back-link__icon')).toBe(true);
});

test('page-detail-layout width=md emits md token and omits optional slots when unset', () => {
  const html = renderToStaticMarkup(
    <PageDetailLayout width="md" title="标题">
      <div>only-body</div>
    </PageDetailLayout>,
  );
  expect(hasClass(html, 'nimi-page-detail-layout--width-md')).toBe(true);
  expect(hasClass(html, 'nimi-page-detail-layout__back-row')).toBe(false);
  expect(hasClass(html, 'nimi-page-detail-layout__subnav')).toBe(false);
  expect(hasClass(html, 'nimi-page-detail-layout__before-content')).toBe(false);
  expect(hasClass(html, 'nimi-page-detail-layout__actions')).toBe(false);
});

test('back-link asChild merges visual onto child element (router-friendly)', () => {
  const html = renderToStaticMarkup(
    <BackLink asChild>
      <a href="/profile" data-testid="custom-link">
        返回档案
      </a>
    </BackLink>,
  );
  expect(html).toMatch(/data-testid="custom-link"/);
  expect(html).toMatch(/href="\/profile"/);
  expect(html).toMatch(/返回档案/);
  expect(hasClass(html, 'nimi-back-link')).toBe(true);
});

test('timeline renders rail and groups with past+future dot variants and divider', () => {
  const html = renderToStaticMarkup(
    <Timeline>
      <TimelineGroup date="2026-06-01" secondaryLabel="2 条" variant="future" tone="info">
        <div>future-card</div>
      </TimelineGroup>
      <TimelineDivider label="今天" />
      <TimelineGroup date="2026-05-17" secondaryLabel="3 岁 6 个月" variant="past" tone="brand" isLast>
        <div>past-card</div>
      </TimelineGroup>
    </Timeline>,
  );

  expect(html).toMatch(/2026-06-01/);
  expect(html).toMatch(/2026-05-17/);
  expect(html).toMatch(/3 岁 6 个月/);
  expect(html).toMatch(/今天/);
  expect(html).toMatch(/future-card/);
  expect(html).toMatch(/past-card/);
  expect(hasClass(html, 'nimi-timeline')).toBe(true);
  expect(hasClass(html, 'nimi-timeline__rail')).toBe(true);
  expect(hasClass(html, 'nimi-timeline-group')).toBe(true);
  expect(hasClass(html, 'nimi-timeline-group--past')).toBe(true);
  expect(hasClass(html, 'nimi-timeline-group--future')).toBe(true);
  expect(hasClass(html, 'nimi-timeline-group__dot')).toBe(true);
  expect(hasClass(html, 'nimi-timeline-group__dot--solid')).toBe(true);
  expect(hasClass(html, 'nimi-timeline-group__dot--dashed')).toBe(true);
  expect(hasClass(html, 'nimi-timeline-group__header')).toBe(true);
  expect(hasClass(html, 'nimi-timeline-group__date')).toBe(true);
  expect(hasClass(html, 'nimi-timeline-group__secondary')).toBe(true);
  expect(hasClass(html, 'nimi-timeline-group__body')).toBe(true);
  expect(hasClass(html, 'nimi-timeline-divider')).toBe(true);
  expect(hasClass(html, 'nimi-timeline-divider__label')).toBe(true);
  expect(hasClass(html, 'nimi-timeline-divider__rule')).toBe(true);
});

test('timeline ring dot variant emits dual-layer ring + core nodes', () => {
  const html = renderToStaticMarkup(
    <Timeline>
      <TimelineGroup date="2026-05" variant="past" dotVariant="ring" tone="info" isLast>
        <div>ring-card</div>
      </TimelineGroup>
    </Timeline>,
  );
  expect(hasClass(html, 'nimi-timeline-group__dot--ring')).toBe(true);
  expect(hasClass(html, 'nimi-timeline-group__dot-core')).toBe(true);
});
