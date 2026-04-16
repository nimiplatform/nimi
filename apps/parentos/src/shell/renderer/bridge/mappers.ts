/**
 * mappers.ts — Shared row-to-profile mapping utilities.
 *
 * Centralizes JSON deserialization from SQLite TEXT columns.
 */

import type { ChildRow } from './sqlite-bridge.js';
import type { ChildProfile, NurtureMode } from '../app-shell/app-store.js';

function parseJsonOrNull(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseStringArray(raw: string | null): string[] | null {
  const parsed = parseJsonOrNull(raw);
  if (!Array.isArray(parsed)) return null;
  return parsed.map((item) => String(item));
}

function parseRecorderProfiles(raw: string | null): Array<{ id: string; name: string }> | null {
  const parsed = parseJsonOrNull(raw);
  if (!Array.isArray(parsed)) return null;
  return parsed
    .filter((item): item is Record<string, unknown> => item != null && typeof item === 'object')
    .map((item) => ({
      id: String(item.id ?? ''),
      name: String(item.name ?? ''),
    }))
    .filter((item) => item.id.length > 0 && item.name.length > 0);
}

function parseModeOverrides(raw: string | null): Record<string, NurtureMode> | null {
  const parsed = parseJsonOrNull(raw);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return null;
  const entries = Object.entries(parsed)
    .filter((entry): entry is [string, NurtureMode] =>
      entry[1] === 'relaxed' || entry[1] === 'balanced' || entry[1] === 'advanced',
    );
  return Object.fromEntries(entries);
}

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
    nurtureModeOverrides: parseModeOverrides(row.nurtureModeOverrides),
    allergies: parseStringArray(row.allergies),
    medicalNotes: parseStringArray(row.medicalNotes),
    recorderProfiles: parseRecorderProfiles(row.recorderProfiles),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
