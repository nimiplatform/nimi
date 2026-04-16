import { invoke } from '@tauri-apps/api/core';

export function createFamily(familyId: string, displayName: string, now: string) {
  return invoke<void>('create_family', { familyId, displayName, now });
}

export function getFamily() {
  return invoke<{
    familyId: string;
    displayName: string;
    createdAt: string;
    updatedAt: string;
  } | null>('get_family');
}

export interface ChildRow {
  childId: string;
  familyId: string;
  displayName: string;
  gender: string;
  birthDate: string;
  birthWeightKg: number | null;
  birthHeightCm: number | null;
  birthHeadCircCm: number | null;
  avatarPath: string | null;
  nurtureMode: string;
  nurtureModeOverrides: string | null;
  allergies: string | null;
  medicalNotes: string | null;
  recorderProfiles: string | null;
  createdAt: string;
  updatedAt: string;
}

export function getChild(childId: string) {
  return invoke<ChildRow | null>('get_child', { childId });
}

export function createChild(params: {
  childId: string;
  familyId: string;
  displayName: string;
  gender: string;
  birthDate: string;
  birthWeightKg: number | null;
  birthHeightCm: number | null;
  birthHeadCircCm: number | null;
  avatarPath: string | null;
  nurtureMode: string;
  nurtureModeOverrides: string | null;
  allergies: string | null;
  medicalNotes: string | null;
  recorderProfiles: string | null;
  now: string;
}) {
  return invoke<void>('create_child', params);
}

export function getChildren(familyId: string) {
  return invoke<ChildRow[]>('get_children', { familyId });
}

export function updateChild(params: {
  childId: string;
  displayName: string;
  gender: string;
  birthDate: string;
  birthWeightKg: number | null;
  birthHeightCm: number | null;
  birthHeadCircCm: number | null;
  avatarPath: string | null;
  nurtureMode: string;
  nurtureModeOverrides: string | null;
  allergies: string | null;
  medicalNotes: string | null;
  recorderProfiles: string | null;
  now: string;
}) {
  return invoke<void>('update_child', params);
}

export function deleteChild(childId: string) {
  return invoke<void>('delete_child', { childId });
}
