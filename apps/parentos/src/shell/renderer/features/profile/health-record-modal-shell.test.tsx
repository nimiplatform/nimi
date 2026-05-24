// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, DatePicker, TextField } from '@nimiplatform/kit/ui';
import {
  HealthRecordModalShell,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from './health-record-modal-shell.js';

const NUMBER_INPUT_CLASS = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

describe('HealthRecordModalShell', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders profile modals through a viewport-level solid overlay shell', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const { container } = render(
      <HealthRecordModalShell open size="M" ariaLabel="growth-record-modal" onClose={vi.fn()}>
        <ModalHeader title="添加生长记录" icon="📏" onClose={vi.fn()} />
        <ModalContent>
          <TextField
            aria-label="height"
            type="number"
            defaultValue="120.5"
            className="w-full min-h-12"
            inputClassName={NUMBER_INPUT_CLASS}
          />
        </ModalContent>
        <ModalFooter>
          <Button type="button" onClick={vi.fn()} tone="primary" size="md">保存</Button>
        </ModalFooter>
      </HealthRecordModalShell>,
      { container: host },
    );

    expect(container.querySelector('[role="dialog"]')).toBeNull();

    const dialog = screen.getByRole('dialog', { name: 'growth-record-modal' });
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.className).toContain('fixed');
    expect(dialog.className).toContain('inset-0');
    expect(dialog.className).toContain('z-[100]');
    expect(dialog.className).toContain('bg-[var(--nimi-scrim-modal)]');

    const panel = dialog.querySelector('.parentos-health-modal-panel');
    expect(panel?.getAttribute('data-nimi-material')).toBe('solid');
    expect(panel?.getAttribute('data-nimi-tone')).toBe('card');
    expect(panel?.className).toContain('bg-[var(--nimi-surface-card)]');

    const footer = dialog.querySelector('footer');
    expect(footer?.className).toContain('bg-[var(--nimi-surface-card)]');
    expect(footer?.className).not.toContain('glass');

    const numberInput = screen.getByLabelText('height');
    expect(numberInput.className).toContain('[appearance:textfield]');
    expect(numberInput.className).toContain('[&::-webkit-inner-spin-button]:appearance-none');
  });

  it('keeps date picker panels above the modal shell layer', async () => {
    render(
      <HealthRecordModalShell open size="M" ariaLabel="growth-record-modal" onClose={vi.fn()}>
        <ModalHeader title="添加生长记录" icon="📏" onClose={vi.fn()} />
        <ModalContent>
          <DatePicker value="2026-05-14" onChange={vi.fn()} className="h-12" />
        </ModalContent>
      </HealthRecordModalShell>,
    );

    fireEvent.click(screen.getByRole('textbox'));

    await waitFor(() => {
      const panel = document.body.querySelector('.nimi-date-picker-panel');
      expect(panel).toBeTruthy();
      expect(panel?.className).toContain('z-[120]');
    });
  });
});
