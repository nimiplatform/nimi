import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test } from 'vitest';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  IconButton,
  NimiThemeProvider,
  OverlayShell,
  Popover,
  PopoverContent,
  SearchField,
  SelectField,
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
  Tooltip,
  TooltipProvider,
  cn,
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
      <Surface tone="card" elevation="floating" interactive active>card</Surface>
      <SettingsCard>settings-card</SettingsCard>
      <SettingsPageShell contentClassName="px-2 py-2">
        <SettingsSectionTitle description="Shared settings section">Preferences</SettingsSectionTitle>
      </SettingsPageShell>
      <Button tone="primary" leadingIcon={<span />} trailingIcon={<span />}>save</Button>
      <IconButton tone="ghost" size="sm" icon={<span />} aria-label="Icon action" />
      <SearchField placeholder="Search" />
      <StatusBadge tone="success">ready</StatusBadge>
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
  expect(hasClass(html, 'nimi-action')).toBe(true);
  expect(hasClass(html, 'nimi-action--primary')).toBe(true);
  expect(hasClass(html, 'nimi-action--ghost')).toBe(true);
  expect(hasClass(html, 'nimi-action--size-sm')).toBe(true);
  expect(hasClass(html, 'nimi-action--size-md')).toBe(true);
  expect(hasClass(html, 'nimi-action--icon')).toBe(true);
  expect(hasClass(html, 'nimi-action__leading')).toBe(true);
  expect(hasClass(html, 'nimi-action__trailing')).toBe(true);
  expect(hasClass(html, 'nimi-action__icon')).toBe(true);
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

test('theme provider renders children', () => {
  const html = renderToStaticMarkup(
    <NimiThemeProvider accentPack="nimi-accent" defaultScheme="dark">
      <Surface tone="panel">theme</Surface>
    </NimiThemeProvider>,
  );

  expect(html).toMatch(/theme/);
});

test('cn utility merges classes correctly', () => {
  expect(cn('foo', 'bar')).toBe('foo bar');
  expect(cn('p-4', false, null, 'text-sm')).toBe('p-4 text-sm');
  expect(cn('p-4', 'p-6')).toBe('p-6');
});
