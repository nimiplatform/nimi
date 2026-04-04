/**
 * mappers.ts — Shared row-to-profile mapping utilities.
 *
 * Centralizes JSON deserialization from SQLite TEXT columns.
 */

import type { ChildRow } from './sqlite-bridge.js';
import type { ChildProfile, NurtureMode } from '../app-shell/app-store.js';

/**
 * Map a raw SQLite ChildRow (JSON stored as TEXT) to a typed ChildProfile.
 */
export function mapChildRow(row: ChildRow): ChildProfile {
  return {
    childId: row.childId,
    familyId: row.familyId,
    displayName: row.displayName,
    gender: row.gender as 'male' | 'female',
    birthDate: row.birthDate,
    birthWeightKg: row.birthWeightKg,
    birthHeightCm: row.birthHeightCm,
    birthHeadCircCm: row.birthHeadCircCm,
    avatarPath: row.avatarPath,
    nurtureMode: row.nurtureMode as NurtureMode,
    nurtureModeOverrides: row.nurtureModeOverrides ? JSON.parse(row.nurtureModeOverrides) : null,
    allergies: row.allergies ? JSON.parse(row.allergies) : null,
    medicalNotes: row.medicalNotes ? JSON.parse(row.medicalNotes) : null,
    recorderProfiles: row.recorderProfiles ? JSON.parse(row.recorderProfiles) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
