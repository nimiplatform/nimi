import { describe, expect, it } from 'vitest';
import { mapChildRow } from './mappers.js';

describe('mapChildRow', () => {
  it('decodes JSON TEXT fields into typed child profile state', () => {
    const mapped = mapChildRow({
      childId: 'child-1',
      familyId: 'family-1',
      displayName: 'Mimi',
      gender: 'female',
      birthDate: '2024-01-15',
      birthWeightKg: 3.2,
      birthHeightCm: 50.1,
      birthHeadCircCm: 34.2,
      avatarPath: null,
      nurtureMode: 'balanced',
      nurtureModeOverrides: '{"sleep":"advanced"}',
      allergies: '["egg"]',
      medicalNotes: '["note-1"]',
      recorderProfiles: '[{"id":"rec-1","name":"Mom"}]',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(mapped.nurtureModeOverrides).toEqual({ sleep: 'advanced' });
    expect(mapped.allergies).toEqual(['egg']);
    expect(mapped.medicalNotes).toEqual(['note-1']);
    expect(mapped.recorderProfiles).toEqual([{ id: 'rec-1', name: 'Mom' }]);
  });
});
