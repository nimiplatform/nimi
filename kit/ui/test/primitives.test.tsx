import { act, useState } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
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
  OVERLAY_SHELL_SIZE_WIDTH,
  PillTabs,
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
  AccountPanel,
  Slider,
  BackLink,
  AppCardSurface,
  Breadcrumb,
  PageDetailLayout,
  CompactAction,
  DataList,
  DataTable,
  FieldTrigger,
  IconToggleAction,
  Pagination,
  ScrollArea,
  ScrollShell,
  STATE_TONE_CLASS,
  Statistic,
  StatisticGroup,
  Steps,
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

if (!window.HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
}

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
  expect(html).toMatch(/nimi-action__leading[^"]*pointer-events-none/);
  expect(html).toMatch(/nimi-action__trailing[^"]*pointer-events-none/);
  expect(html).toMatch(/nimi-action__icon[^"]*pointer-events-none/);
  expect(html).toMatch(/nimi-action__spinner[^"]*pointer-events-none/);
  expect(html).toMatch(/pointer-events-none[^"]*inline-flex[^"]*min-w-0/);
  expect(hasClass(html, 'nimi-status-badge')).toBe(true);
  expect(hasClass(html, 'nimi-status-badge--success')).toBe(true);
  expect(hasClass(html, 'nimi-status-badge--dot')).toBe(true);
  expect(hasClass(html, 'nimi-status-badge__dot')).toBe(true);
});

test('pill tabs render sliding-indicator slots, radiogroup roles, and active state', () => {
  const html = renderToStaticMarkup(
    <PillTabs
      ariaLabel="Section"
      size="sm"
      value="orthodontic"
      onValueChange={() => {}}
      items={[
        { value: 'history', label: '口腔记录' },
        { value: 'orthodontic', label: '正畸治疗' },
      ]}
    />,
  );

  expect(hasClass(html, 'nimi-pill-tabs')).toBe(true);
  expect(hasClass(html, 'nimi-pill-tabs__indicator')).toBe(true);
  expect(hasClass(html, 'nimi-pill-tabs__tab')).toBe(true);
  expect(hasClass(html, 'nimi-pill-tabs__tab--active')).toBe(true);
  expect(html).toMatch(/role="radiogroup"/);
  expect(html).toMatch(/role="radio"/);
  expect(html).toMatch(/aria-checked="true"/);
  expect(html).toMatch(/正畸治疗/);
});

test('surface material transparency downgrade is deterministic', () => {
  expect(downgradeSurfaceMaterial('glass-chrome', 'reduced')).toBe('glass-thick');
  expect(downgradeSurfaceMaterial('glass-thick', 'reduced')).toBe('glass-regular');
  expect(downgradeSurfaceMaterial('glass-regular', 'reduced')).toBe('glass-thin');
  expect(downgradeSurfaceMaterial('glass-thin', 'reduced')).toBe('glass-thin');
  expect(downgradeSurfaceMaterial('glass-chrome', 'solid')).toBe('solid');
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

test('overlay shell connects its visible title and description to dialog semantics', async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <OverlayShell
        open
        title={<span>Allow this development project?</span>}
        description={<span>Review the project identity and requested capabilities.</span>}
        dataTestId="semantic-dialog"
      >
        Content
      </OverlayShell>,
    );
    await flush();
  });

  const panel = document.querySelector('[data-testid="semantic-dialog"]') as HTMLElement | null;
  expect(panel).toBeTruthy();
  const titleId = panel!.getAttribute('aria-labelledby');
  const descriptionId = panel!.getAttribute('aria-describedby');
  expect(titleId).toBeTruthy();
  expect(descriptionId).toBeTruthy();
  expect(document.getElementById(titleId!)?.textContent).toBe('Allow this development project?');
  expect(document.getElementById(descriptionId!)?.textContent).toBe(
    'Review the project identity and requested capabilities.',
  );
});

test('overlay shell moves, traps, and restores focus for modal dialogs', async () => {
  function FocusHarness() {
    const [open, setOpen] = useState(false);
    const [closeCount, setCloseCount] = useState(0);
    return (
      <div data-testid="focus-harness">
        <button type="button" data-testid="open-overlay" onClick={() => setOpen(true)}>
          Open
        </button>
        <output data-testid="escape-close-count">{closeCount}</output>
        <OverlayShell
          open={open}
          title="Focus contract"
          description="Focus remains inside this modal until it closes."
          dataTestId="focus-dialog"
          onClose={() => {
            setCloseCount((current) => current + 1);
            setOpen(false);
          }}
        >
          <input data-testid="first-focus-target" aria-label="First target" />
          <button type="button" data-testid="last-focus-target">Last target</button>
        </OverlayShell>
      </div>
    );
  }

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(<FocusHarness />);
    await flush();
  });

  const trigger = document.querySelector('[data-testid="open-overlay"]') as HTMLButtonElement;
  trigger.focus();
  await act(async () => {
    trigger.click();
    await flush();
  });

  const panel = document.querySelector('[data-testid="focus-dialog"]') as HTMLElement;
  const first = document.querySelector('[data-testid="first-focus-target"]') as HTMLInputElement;
  const last = document.querySelector('[data-testid="last-focus-target"]') as HTMLButtonElement;
  expect(panel.getAttribute('role')).toBe('dialog');
  expect(panel.getAttribute('aria-modal')).toBe('true');
  expect(panel.contains(document.activeElement)).toBe(true);
  expect(document.activeElement).toBe(first);
  expect(container.getAttribute('aria-hidden')).toBe('true');

  last.focus();
  last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  expect(document.activeElement).toBe(first);

  first.focus();
  first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
  expect(document.activeElement).toBe(last);

  await act(async () => {
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    await flush();
  });

  // AnimatePresence runs the spring exit before unmount; wait for it.
  await vi.waitFor(() => {
    expect(document.querySelector('[data-testid="focus-dialog"]')).toBeNull();
  });
  expect(document.querySelector('[data-testid="escape-close-count"]')?.textContent).toBe('1');
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(trigger);
  });
  expect(container.hasAttribute('aria-hidden')).toBe(false);
});

test('overlay shell closes once from the backdrop and can keep the backdrop inert', async () => {
  function BackdropHarness() {
    const [open, setOpen] = useState(true);
    const [closeCount, setCloseCount] = useState(0);
    const [closeOnBackdrop, setCloseOnBackdrop] = useState(false);
    return (
      <div>
        <button type="button" data-testid="allow-backdrop" onClick={() => setCloseOnBackdrop(true)}>
          Allow backdrop close
        </button>
        <output data-testid="close-count">{closeCount}</output>
        <OverlayShell
          open={open}
          title="Backdrop contract"
          closeOnBackdrop={closeOnBackdrop}
          dataTestId="backdrop-dialog"
          onClose={() => {
            setCloseCount((current) => current + 1);
            setOpen(false);
          }}
        >
          <button type="button">Inside</button>
        </OverlayShell>
      </div>
    );
  }

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(<BackdropHarness />);
    await flush();
  });

  let backdrop = document.querySelector('.nimi-overlay-backdrop') as HTMLElement;
  await act(async () => {
    backdrop.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    backdrop.click();
    await flush();
  });
  expect(document.querySelector('[data-testid="backdrop-dialog"]')).toBeTruthy();
  expect(document.querySelector('[data-testid="close-count"]')?.textContent).toBe('0');

  await act(async () => {
    (document.querySelector('[data-testid="allow-backdrop"]') as HTMLButtonElement).click();
    await flush();
  });
  backdrop = document.querySelector('.nimi-overlay-backdrop') as HTMLElement;
  await act(async () => {
    backdrop.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    backdrop.click();
    await flush();
    await flush();
  });
  // AnimatePresence runs the spring exit before unmount; wait for it.
  await vi.waitFor(() => {
    expect(document.querySelector('[data-testid="backdrop-dialog"]')).toBeNull();
  });
  expect(document.querySelector('[data-testid="close-count"]')?.textContent).toBe('1');
});

test('select field ignores empty option values reserved by Radix', () => {
  let html = '';
  expect(() => {
    html = renderToStaticMarkup(
      <SelectField
        value=""
        placeholder="Select a connector"
        options={[
          { value: '', label: 'Invalid empty option' },
          { value: 'connector.openai', label: 'OpenAI' },
        ]}
      />,
    );
  }).not.toThrow();
  expect(html).toContain('enabled:hover:border-[var(--nimi-field-focus)]');
});

test('select field retains content until its symmetric exit completes', async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  const renderSelect = (open: boolean) => (
    <SelectField
      open={open}
      value="connector.openai"
      aria-label="Connector"
      options={[{ value: 'connector.openai', label: 'OpenAI' }]}
    />
  );

  await act(async () => {
    root?.render(renderSelect(true));
    await flush();
  });
  expect(document.querySelector('[role="listbox"]')).toBeTruthy();
  expect(document.querySelector('.nimi-overlay-panel--popover')).toBeTruthy();

  await act(async () => {
    root?.render(renderSelect(false));
    await flush();
  });
  expect(document.querySelector('[role="listbox"]')).toBeTruthy();
  expect(document.querySelector('.nimi-overlay-panel--popover')).toBeTruthy();

  await vi.waitFor(() => {
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });
  expect(document.querySelector('[role="combobox"]')?.textContent).toContain('OpenAI');
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

test('toggle primitive is a local button switch without Radix ref state', async () => {
  const changes: boolean[] = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(<Toggle checked={false} onChange={(next) => changes.push(next)} />);
    await flush();
  });

  const toggle = container.querySelector('button[role="switch"]');
  expect(toggle).toBeTruthy();
  expect(toggle?.getAttribute('aria-checked')).toBe('false');
  expect(toggle?.getAttribute('data-state')).toBe('unchecked');

  await act(async () => {
    (toggle as HTMLButtonElement).click();
    await flush();
  });

  expect(changes).toEqual([true]);
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

test('theme provider applies semantic accent pack and scheme without app truth', async () => {
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
      <NimiThemeProvider accentPack="nimi-accent" scheme="light">
        <Surface tone="panel">theme</Surface>
      </NimiThemeProvider>,
    );
    await flush();
  });

  expect(document.documentElement.dataset.nimiScheme).toBe('light');
  expect(document.documentElement.dataset.nimiAccent).toBe('nimi-accent');
  expect(document.documentElement.classList.contains('dark')).toBe(false);
  expect(document.documentElement.classList.contains('nimi-theme-accent--nimi-accent')).toBe(true);
});

test('cn utility merges classes correctly', () => {
  expect(cn('foo', 'bar')).toBe('foo bar');
  expect(cn('p-4', false, null, 'text-sm')).toBe('p-4 text-sm');
  expect(cn('p-4', 'p-6')).toBe('p-6');
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
