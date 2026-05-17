// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { HealthCaptureModal } from './health-capture-modal.js';
import { useAppStore, type ChildProfile } from '../../app-shell/app-store.js';

vi.mock('../../bridge/sqlite-bridge.js', async () => ({
  saveHealthRecordCapture: vi.fn(),
  insertOutdoorRecord: vi.fn(),
  insertMeasurement: vi.fn(),
  insertTannerAssessment: vi.fn(),
  insertFitnessAssessment: vi.fn(),
  saveAttachment: vi.fn(),
}));

beforeAll(() => {
  const child: ChildProfile = {
    childId: 'child-1',
    familyId: 'family-1',
    displayName: 'Test',
    birthDate: '2020-12-17',
    gender: 'male',
    birthWeightKg: null,
    birthHeightCm: null,
    birthHeadCircCm: null,
    avatarPath: null,
    nurtureMode: 'balanced',
    nurtureModeOverrides: null,
    allergies: null,
    medicalNotes: null,
    recorderProfiles: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  useAppStore.setState({ activeChildId: 'child-1', children: [child] });
});

describe('HealthCaptureModal', () => {
  it('opens to the requested sidebar group when initialGroupId is provided', () => {
    render(
      <HealthCaptureModal
        open
        childId="child-1"
        childBirthDate="2020-12-17"
        initialGroupId="outdoor"
        onClose={() => undefined}
      />,
    );

    // OutdoorCaptureContent renders the "记录户外活动" header for the outdoor group.
    expect(screen.getByText('记录户外活动')).toBeTruthy();
  });

  it('falls back to the first sidebar group when no initialGroupId is provided', () => {
    render(
      <HealthCaptureModal
        open
        childId="child-1"
        childBirthDate="2020-12-17"
        onClose={() => undefined}
      />,
    );

    // Default order opens growth first.
    expect(screen.getByText('添加生长记录')).toBeTruthy();
  });
});
