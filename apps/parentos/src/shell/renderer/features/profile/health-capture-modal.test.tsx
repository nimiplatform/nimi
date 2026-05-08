// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HealthCaptureModal } from './health-capture-modal.js';

vi.mock('../../bridge/sqlite-bridge.js', async () => {
  return {
    saveHealthRecordCapture: vi.fn(),
  };
});

describe('HealthCaptureModal', () => {
  it('renders grouped protocols and protocol-defined required fields', () => {
    render(
      <HealthCaptureModal
        open
        childId="child-1"
        childBirthDate="2020-12-17"
        initialIntent={{
          protocolId: 'growth-child-quarterly',
          mode: 'manual',
          effectiveDate: '2026-05-02',
        }}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'health-capture-modal' })).toBeTruthy();
    expect(screen.getByText('Growth')).toBeTruthy();
    expect(screen.getAllByText('Child growth record').length).toBeGreaterThan(0);
    expect(screen.getByText('Height (cm)')).toBeTruthy();
    expect(screen.getByText('Weight (kg)')).toBeTruthy();
    expect(screen.queryByText('BMI')).toBeNull();
    expect(screen.queryByText('Vaccine administration')).toBeNull();
  });

  it('marks each required field label with * and not optional ones', () => {
    render(
      <HealthCaptureModal
        open
        childId="child-1"
        childBirthDate="2020-12-17"
        initialIntent={{
          protocolId: 'vision-full-exam',
          mode: 'manual',
          effectiveDate: '2026-05-02',
        }}
        onClose={() => undefined}
      />,
    );

    const requiredLabel = screen.getByText('Left visual acuity');
    expect(requiredLabel.parentElement?.textContent).toContain('*');
    const optionalLabel = screen.getByText('Left axial length (mm)');
    expect(optionalLabel.parentElement?.textContent ?? '').not.toContain('*');
  });

  it('highlights empty required fields and shows a Chinese hint when saving with missing data', () => {
    const dialog = render(
      <HealthCaptureModal
        open
        childId="child-1"
        childBirthDate="2020-12-17"
        initialIntent={{
          protocolId: 'vision-full-exam',
          mode: 'manual',
          effectiveDate: '2026-05-02',
          prefillValues: { 'vision.left_visual_acuity': { value: '1.2' } },
        }}
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    const rightAcuityLabel = screen.getByText('Right visual acuity');
    const rightAcuityField = rightAcuityLabel.closest('label');
    expect(rightAcuityField).not.toBeNull();
    const invalidInput = within(rightAcuityField as HTMLElement).getByRole('spinbutton');
    expect(invalidInput.getAttribute('aria-invalid')).toBe('true');
    expect(within(rightAcuityField as HTMLElement).getByText('Please enter Right visual acuity')).toBeTruthy();
    expect(dialog.getByText('Some required fields are missing — please complete them before saving.')).toBeTruthy();

    const leftAcuityLabel = screen.getByText('Left visual acuity');
    const leftAcuityField = leftAcuityLabel.closest('label');
    expect(leftAcuityField).not.toBeNull();
    const validInput = within(leftAcuityField as HTMLElement).getByRole('spinbutton');
    expect(validInput.getAttribute('aria-invalid')).toBeNull();
  });
});
