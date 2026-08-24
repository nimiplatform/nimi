import { act, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import {
  Dialog,
  DialogContent,
  EmptyState,
  FieldShell,
  LoadingSkeleton,
  NimiText,
  OVERLAY_SHELL_SIZE_WIDTH,
  OverlayShell,
  SelectField,
  SidebarSearch,
  Statistic,
  Steps,
  TextField,
  Timeline,
  TimelineGroup,
  Toggle,
} from '../src/index.js';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

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

test('NimiText overline role applies the generated overline scale', () => {
  const html = renderToStaticMarkup(<NimiText role="overline">Beta lane</NimiText>);
  expect(html).toContain('nimi-text--overline');
  expect(html).toContain('text-[length:var(--nimi-type-overline-size)]');
  expect(html).toContain('leading-[var(--nimi-type-overline-line-height)]');
  expect(html).toContain('font-[var(--nimi-type-overline-weight)]');
  expect(html).toContain('tracking-[var(--nimi-type-overline-letter-spacing)]');
  expect(html).toMatch(/^<span[\s>]/);
  expect(html).toContain('Beta lane');
});

test('EmptyState title accepts a ReactNode, not just a string', () => {
  const html = renderToStaticMarkup(
    <EmptyState title={<span data-testid="rich-title">Nothing here yet</span>} />,
  );
  expect(html).toContain('data-testid="rich-title"');
  expect(html).toContain('Nothing here yet');
});

test('FieldShell links its label to the control through htmlFor/id', async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <div>
        <FieldShell label="Display name" description="Shown on your profile">
          <TextField defaultValue="nimi" />
        </FieldShell>
        <FieldShell label="Handle">
          <TextField id="caller-id" defaultValue="nimi" />
        </FieldShell>
      </div>,
    );
    await flush();
  });

  const labels = container.querySelectorAll('label.nimi-field-shell__label');
  expect(labels).toHaveLength(2);

  const generatedInput = container.querySelector('input:not(#caller-id)') as HTMLInputElement;
  expect(generatedInput.id).toBeTruthy();
  expect(labels[0]!.getAttribute('for')).toBe(generatedInput.id);
  expect(generatedInput.getAttribute('aria-describedby')).toBeTruthy();

  // A caller-provided id wins over the generated one.
  expect(labels[1]!.getAttribute('for')).toBe('caller-id');
});

test('LoadingSkeleton is presentational unless a localized loading label is supplied', () => {
  const decorativeHtml = renderToStaticMarkup(<LoadingSkeleton lines={2} />);
  expect(decorativeHtml).toContain('aria-hidden="true"');
  expect(decorativeHtml).not.toContain('aria-live');

  const announcedHtml = renderToStaticMarkup(<LoadingSkeleton lines={2} label="Loading models…" />);
  expect(announcedHtml).toContain('role="status"');
  expect(announcedHtml).toContain('aria-live="polite"');
  expect(announcedHtml).toContain('Loading models…');
  expect(announcedHtml).not.toContain('aria-hidden="true"');
});

test('Steps marks the current step with aria-current="step"', () => {
  const html = renderToStaticMarkup(
    <Steps
      ariaLabel="Onboarding"
      items={[
        { id: 'one', title: 'Done', status: 'complete' },
        { id: 'two', title: 'Doing', status: 'current' },
        { id: 'three', title: 'Todo', status: 'pending' },
      ]}
    />,
  );
  expect(html.match(/aria-current="step"/g)).toHaveLength(1);
  expect(html).toMatch(/<li[^>]*aria-current="step"[^>]*>(?:(?!<li).)*Doing/s);
});

test('Toggle prefers onValueChange and keeps onChange as a legacy alias', async () => {
  const valueChanges: boolean[] = [];
  const legacyChanges: boolean[] = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <div>
        <Toggle checked={false} onValueChange={(next) => valueChanges.push(next)} ariaLabel="new" />
        <Toggle checked={false} onChange={(next) => legacyChanges.push(next)} ariaLabel="legacy" />
        <Toggle
          checked={false}
          onValueChange={(next) => valueChanges.push(next)}
          onChange={(next) => legacyChanges.push(next)}
          ariaLabel="both"
        />
      </div>,
    );
    await flush();
  });

  const byLabel = (name: string) => container!.querySelector(`[aria-label="${name}"]`) as HTMLButtonElement;

  await act(async () => {
    byLabel('new').click();
    await flush();
  });
  expect(valueChanges).toEqual([true]);
  expect(legacyChanges).toEqual([]);

  await act(async () => {
    byLabel('legacy').click();
    await flush();
  });
  expect(legacyChanges).toEqual([true]);

  await act(async () => {
    byLabel('both').click();
    await flush();
  });
  expect(valueChanges).toEqual([true, true]);
  expect(legacyChanges).toEqual([true]);
});

test('OverlayShell accepts lowercase sizes and keeps legacy uppercase aliases', async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <div>
        <OverlayShell open title="Small" size="sm" data-testid="shell-sm">content</OverlayShell>
        <OverlayShell open title="Legacy" size="M" data-testid="shell-legacy">content</OverlayShell>
      </div>,
    );
    await flush();
  });

  const sm = document.querySelector('[data-testid="shell-sm"]') as HTMLElement;
  expect(sm.className).toContain('nimi-overlay-panel--size-s');
  expect(sm.style.width).toBe('480px');

  const legacy = document.querySelector('[data-testid="shell-legacy"]') as HTMLElement;
  expect(legacy.className).toContain('nimi-overlay-panel--size-m');
  expect(legacy.style.width).toBe('720px');

  expect(OVERLAY_SHELL_SIZE_WIDTH.sm).toBe('480px');
  expect(OVERLAY_SHELL_SIZE_WIDTH.S).toBe('480px');
  expect(OVERLAY_SHELL_SIZE_WIDTH.xl).toBe('1120px');
  expect(OVERLAY_SHELL_SIZE_WIDTH.XL).toBe('1120px');
  expect(OVERLAY_SHELL_SIZE_WIDTH.full).toBe('calc(100vw - 32px)');
});

test('DialogContent and OverlayShell accept data-testid, preferring it over dataTestId', async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <div>
        <Dialog open>
          <DialogContent data-testid="content-kebab">plain</DialogContent>
        </Dialog>
        <Dialog open>
          <DialogContent dataTestId="content-camel">camel</DialogContent>
        </Dialog>
        <OverlayShell open title="Both" dataTestId="shell-camel" data-testid="shell-kebab">
          content
        </OverlayShell>
      </div>,
    );
    await flush();
  });

  expect(document.querySelector('[data-testid="content-kebab"]')).toBeTruthy();
  expect(document.querySelector('[data-testid="content-camel"]')).toBeTruthy();
  expect(document.querySelector('[data-testid="shell-kebab"]')).toBeTruthy();
  expect(document.querySelector('[data-testid="shell-camel"]')).toBeNull();
});

test('DialogContent moves initial focus inside and returns it to the trigger', async () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <button type="button" data-testid="open-dialog" onClick={() => setOpen(true)}>
          Open
        </button>
        <Dialog open={open} onOpenChange={(next) => setOpen(next)}>
          <DialogContent data-testid="focus-content" onClose={() => setOpen(false)}>
            <button type="button" data-testid="inside-target">Inside</button>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(<Harness />);
    await flush();
  });

  const trigger = document.querySelector('[data-testid="open-dialog"]') as HTMLButtonElement;
  trigger.focus();
  await act(async () => {
    trigger.click();
    await flush();
  });

  const panel = document.querySelector('[data-testid="focus-content"]') as HTMLElement;
  const inside = document.querySelector('[data-testid="inside-target"]') as HTMLButtonElement;
  expect(panel).toBeTruthy();
  expect(panel.contains(document.activeElement)).toBe(true);
  expect(document.activeElement).toBe(inside);

  await act(async () => {
    inside.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flush();
    await flush();
  });

  await vi.waitFor(() => {
    expect(document.querySelector('[data-testid="focus-content"]')).toBeNull();
  });
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(trigger);
  });
});

test('SelectField warns in non-production when an empty-string option is dropped', async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

  await act(async () => {
    root?.render(
      <SelectField
        value=""
        placeholder="Pick"
        options={[
          { value: '', label: 'Invalid empty option' },
          { value: 'a', label: 'A' },
        ]}
      />,
    );
    await flush();
  });

  expect(warn).toHaveBeenCalledTimes(1);
  expect(String(warn.mock.calls[0]?.[0])).toContain('empty-string');
  warn.mockRestore();
});

test('Statistic maps the primary tone to the accent class', () => {
  const primaryHtml = renderToStaticMarkup(<Statistic label="L" value="1" tone="primary" />);
  expect(primaryHtml).toContain('text-[var(--nimi-action-primary-bg)]');
});

test('TimelineGroup defaults to primary tone and keeps the brand alias', () => {
  const html = renderToStaticMarkup(
    <Timeline>
      <TimelineGroup date="Today">
        <div>entry</div>
      </TimelineGroup>
      <TimelineGroup date="Earlier" tone="brand">
        <div>entry</div>
      </TimelineGroup>
    </Timeline>,
  );
  expect(html.match(/border-\[var\(--nimi-action-primary-bg\)\]/g)?.length).toBeGreaterThanOrEqual(2);
});

test('SidebarSearch prefers onValueChange and keeps onChange as a legacy alias', async () => {
  const valueChanges: string[] = [];
  const legacyChanges: string[] = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <div>
        <SidebarSearch value="" onValueChange={(next) => valueChanges.push(next)} placeholder="New" />
        <SidebarSearch value="" onChange={(next) => legacyChanges.push(next)} placeholder="Legacy" />
        <SidebarSearch
          value=""
          onValueChange={(next) => valueChanges.push(next)}
          onChange={(next) => legacyChanges.push(next)}
          placeholder="Both"
        />
      </div>,
    );
    await flush();
  });

  const type = async (placeholder: string, nextValue: string) => {
    const input = container!.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, nextValue);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
  };

  await act(async () => type('New', 'a'));
  expect(valueChanges).toEqual(['a']);
  expect(legacyChanges).toEqual([]);

  await act(async () => type('Legacy', 'b'));
  expect(legacyChanges).toEqual(['b']);

  await act(async () => type('Both', 'c'));
  expect(valueChanges).toEqual(['a', 'c']);
  expect(legacyChanges).toEqual(['b']);
});
