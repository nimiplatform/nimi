/**
 * Copyright Data Client — Forge adapter (FG-COPYRIGHT-001..015)
 *
 * Registrations, licenses, attributions, and infringement reporting.
 * Copyright is deferred from the current Forge scope.
 */

import { throwDeferredFeature } from './deferred-feature.js';

export type ForgeCopyrightListQuery = {
  cursor?: string;
  limit?: number;
  status?: string;
};

export type ForgeRegistrationInput = {
  title?: string;
  description?: string;
  assetId?: string;
};

export type ForgeLicenseInput = {
  registrationId?: string;
  templateId?: string;
  status?: string;
};

export type ForgeAttributionInput = {
  targetId?: string;
  targetType?: 'world' | 'agent' | 'post' | 'asset';
  text?: string;
};

export type ForgeInfringementReportInput = {
  registrationId?: string;
  targetUrl?: string;
  reason?: string;
};

export type ForgeCopyrightRegistrationResult = never;
export type ForgeCopyrightRegistrationListResult = never;
export type ForgeCopyrightLicenseResult = never;
export type ForgeCopyrightLicenseListResult = never;
export type ForgeCopyrightAttributionResult = never;
export type ForgeCopyrightAttributionListResult = never;
export type ForgeCopyrightInfringementResult = never;
export type ForgeCopyrightInfringementListResult = never;

export async function createRegistration(_payload: ForgeRegistrationInput): Promise<ForgeCopyrightRegistrationResult> {
  return throwDeferredFeature('copyright', 'Copyright feature is deferred in the current Forge scope');
}

export async function listRegistrations(_params?: ForgeCopyrightListQuery): Promise<ForgeCopyrightRegistrationListResult> {
  return throwDeferredFeature('copyright', 'Copyright feature is deferred in the current Forge scope');
}

export async function getRegistration(_id: string): Promise<ForgeCopyrightRegistrationResult> {
  return throwDeferredFeature('copyright', 'Copyright feature is deferred in the current Forge scope');
}

export async function updateRegistration(
  _id: string,
  _payload: ForgeRegistrationInput,
): Promise<ForgeCopyrightRegistrationResult> {
  return throwDeferredFeature('copyright', 'Copyright feature is deferred in the current Forge scope');
}

export async function revokeRegistration(_id: string): Promise<ForgeCopyrightRegistrationResult> {
  return throwDeferredFeature('copyright', 'Copyright feature is deferred in the current Forge scope');
}

export async function createLicense(_payload: ForgeLicenseInput): Promise<ForgeCopyrightLicenseResult> {
  return throwDeferredFeature('copyright', 'Copyright feature is deferred in the current Forge scope');
}

export async function listLicenses(_params?: ForgeCopyrightListQuery): Promise<ForgeCopyrightLicenseListResult> {
  return throwDeferredFeature('copyright', 'Copyright feature is deferred in the current Forge scope');
}

export async function updateLicense(
  _id: string,
  _payload: ForgeLicenseInput,
): Promise<ForgeCopyrightLicenseResult> {
  return throwDeferredFeature('copyright', 'Copyright feature is deferred in the current Forge scope');
}

export async function revokeLicense(_id: string): Promise<ForgeCopyrightLicenseResult> {
  return throwDeferredFeature('copyright', 'Copyright feature is deferred in the current Forge scope');
}

export async function listAttributions(_params?: ForgeCopyrightListQuery): Promise<ForgeCopyrightAttributionListResult> {
  return throwDeferredFeature('copyright', 'Copyright feature is deferred in the current Forge scope');
}

export async function createAttribution(_payload: ForgeAttributionInput): Promise<ForgeCopyrightAttributionResult> {
  return throwDeferredFeature('copyright', 'Copyright feature is deferred in the current Forge scope');
}

export async function updateAttribution(
  _id: string,
  _payload: ForgeAttributionInput,
): Promise<ForgeCopyrightAttributionResult> {
  return throwDeferredFeature('copyright', 'Copyright feature is deferred in the current Forge scope');
}

export async function submitInfringementReport(
  _payload: ForgeInfringementReportInput,
): Promise<ForgeCopyrightInfringementResult> {
  return throwDeferredFeature('copyright', 'Copyright feature is deferred in the current Forge scope');
}

export async function listInfringementReports(
  _params?: ForgeCopyrightListQuery,
): Promise<ForgeCopyrightInfringementListResult> {
  return throwDeferredFeature('copyright', 'Copyright feature is deferred in the current Forge scope');
}

export async function getInfringementReport(_id: string): Promise<ForgeCopyrightInfringementResult> {
  return throwDeferredFeature('copyright', 'Copyright feature is deferred in the current Forge scope');
}
