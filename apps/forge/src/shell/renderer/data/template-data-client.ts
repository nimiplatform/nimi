/**
 * Template Data Client — Forge adapter (FG-TEMPLATE-001..008)
 *
 * World template browsing, creation, forking, and rating.
 * Template workflows are deferred from the current Forge scope.
 */

import { throwDeferredFeature } from './deferred-feature.js';

export type ForgeTemplateBrowseQuery = {
  query?: string;
  category?: string;
  sort?: 'latest' | 'popular' | 'rating';
  cursor?: string;
  limit?: number;
};

export type ForgeTemplateMutationInput = {
  name?: string;
  description?: string;
  category?: string;
  tags?: string[];
};

export type ForgeTemplateRateInput = {
  rating: number;
  review?: string;
};

export type ForgeTemplateListResult = never;
export type ForgeTemplateDetailResult = never;
export type ForgeTemplateMutationResult = never;

export async function createTemplate(_payload: ForgeTemplateMutationInput): Promise<ForgeTemplateMutationResult> {
  return throwDeferredFeature('template-marketplace', 'Template marketplace is deferred in the current Forge scope');
}

export async function browseTemplates(_params?: ForgeTemplateBrowseQuery): Promise<ForgeTemplateListResult> {
  return throwDeferredFeature('template-marketplace', 'Template marketplace is deferred in the current Forge scope');
}

export async function listMyTemplates(_params?: ForgeTemplateBrowseQuery): Promise<ForgeTemplateListResult> {
  return throwDeferredFeature('template-marketplace', 'Template marketplace is deferred in the current Forge scope');
}

export async function getTemplate(_id: string): Promise<ForgeTemplateDetailResult> {
  return throwDeferredFeature('template-marketplace', 'Template marketplace is deferred in the current Forge scope');
}

export async function updateTemplate(
  _id: string,
  _payload: ForgeTemplateMutationInput,
): Promise<ForgeTemplateMutationResult> {
  return throwDeferredFeature('template-marketplace', 'Template marketplace is deferred in the current Forge scope');
}

export async function archiveTemplate(_id: string): Promise<ForgeTemplateMutationResult> {
  return throwDeferredFeature('template-marketplace', 'Template marketplace is deferred in the current Forge scope');
}

export async function forkTemplate(_id: string): Promise<ForgeTemplateMutationResult> {
  return throwDeferredFeature('template-marketplace', 'Template marketplace is deferred in the current Forge scope');
}

export async function rateTemplate(
  _id: string,
  _payload: ForgeTemplateRateInput,
): Promise<ForgeTemplateMutationResult> {
  return throwDeferredFeature('template-marketplace', 'Template marketplace is deferred in the current Forge scope');
}
