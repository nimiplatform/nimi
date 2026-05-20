/**
 * AI-assisted RealmAgent draft generation (T5-3 / D-EXPL-008 mode
 * `ai_assisted_generation`).
 *
 * The user describes a concept; Nimi generates a candidate draft. Per
 * D-EXPL-010 the result is a draft and never Realm truth — it always enters
 * review before the explicit confirm. Per D-EXPL-011 fields the model returns
 * that are invalid / unsupported are surfaced as warnings, never silently
 * written.
 *
 * Per P-AISC-001 / P-AISC-004 the AI execution path carries an explicit
 * `AIScopeRef` (`REALM_AGENT_CREATION_AI_SCOPE_REF`). The text binding for
 * that scope is resolved from the desktop host AIConfig service; execution
 * runs through the admitted runtime AI bridge — no Explore-layer scope-less
 * runtime AI call.
 */

import type { RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import type { NimiRoutePolicy } from '@nimiplatform/sdk/runtime';
import {
  buildRuntimeRequestMetadata,
  getRuntimeClient,
} from '@runtime/llm-adapter/execution/runtime-ai-bridge.js';
import { getDesktopAIConfigService } from '@renderer/app-shell/providers/desktop-ai-config-service.js';
import {
  createEmptyDraft,
  REALM_AGENT_SECONDARY_TRAITS,
  type RealmAgentCreationDraft,
  type RealmAgentDraftWarning,
  type RealmAgentPrimaryTrait,
  type RealmAgentSecondaryTrait,
} from './realm-agent-creation-draft.js';
import { REALM_AGENT_CREATION_AI_SCOPE_REF } from './realm-agent-creation-ai-scope.js';

const AI_GENERATION_TIMEOUT_MS = 90_000;

const PRIMARY_TRAIT_VALUES: readonly RealmAgentPrimaryTrait[] = [
  'CARING',
  'PLAYFUL',
  'INTELLECTUAL',
  'CONFIDENT',
  'MYSTERIOUS',
  'ROMANTIC',
];

export type AiGenerationOutcome =
  | { ok: true; draft: RealmAgentCreationDraft }
  | { ok: false; error: string };

function buildSystemPrompt(): string {
  return [
    'You generate a candidate character profile for a RealmAgent in a fictional World.',
    'Respond with a single JSON object and nothing else. Use exactly these keys:',
    '"handle" (short lowercase underscore id), "displayName", "concept" (one sentence),',
    '"description" (2-4 sentences), "scenario" (1-3 sentences), "greeting" (one line),',
    `"primaryTrait" (one of: ${PRIMARY_TRAIT_VALUES.join(', ')}),`,
    `"secondaryTraits" (array, up to 3, from: ${REALM_AGENT_SECONDARY_TRAITS.join(', ')}).`,
    'Do not include markdown fences. Do not add commentary.',
  ].join(' ');
}

function resolveTextBinding(): RuntimeRouteBinding | null {
  const config = getDesktopAIConfigService().aiConfig.get(REALM_AGENT_CREATION_AI_SCOPE_REF);
  const binding = config.capabilities.selectedBindings?.['text.generate'];
  return binding && typeof binding === 'object' ? binding : null;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function deriveHandle(raw: string, displayName: string): string {
  const source = raw || displayName;
  return source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
}

/**
 * Map a parsed generation object onto a draft, collecting warnings for any
 * model output that does not fit the typed creation field set.
 */
function generationObjectToDraft(
  worldId: string,
  concept: string,
  obj: Record<string, unknown>,
): RealmAgentCreationDraft {
  const draft = createEmptyDraft(worldId, 'ai_assisted_generation');
  const warnings: RealmAgentDraftWarning[] = [];

  draft.fields.displayName = asTrimmedString(obj.displayName);
  draft.fields.handle = deriveHandle(asTrimmedString(obj.handle), draft.fields.displayName);
  if (!draft.fields.handle) {
    warnings.push({
      field: 'handle',
      message: 'AI did not return a usable handle — set one before submitting.',
    });
  }
  draft.fields.concept = asTrimmedString(obj.concept) || concept.trim();
  draft.fields.description = asTrimmedString(obj.description);
  draft.fields.scenario = asTrimmedString(obj.scenario);
  draft.fields.greeting = asTrimmedString(obj.greeting);

  const primaryRaw = asTrimmedString(obj.primaryTrait).toUpperCase();
  if (PRIMARY_TRAIT_VALUES.includes(primaryRaw as RealmAgentPrimaryTrait)) {
    draft.fields.primaryTrait = primaryRaw as RealmAgentPrimaryTrait;
  } else if (primaryRaw) {
    warnings.push({
      field: 'primaryTrait',
      message: `AI suggested an unsupported primary trait "${primaryRaw}" — it was dropped. Pick one in review.`,
    });
  }

  if (Array.isArray(obj.secondaryTraits)) {
    const accepted: RealmAgentSecondaryTrait[] = [];
    const rejected: string[] = [];
    for (const entry of obj.secondaryTraits) {
      const value = asTrimmedString(entry).toUpperCase();
      if ((REALM_AGENT_SECONDARY_TRAITS as readonly string[]).includes(value)) {
        if (accepted.length < 3 && !accepted.includes(value as RealmAgentSecondaryTrait)) {
          accepted.push(value as RealmAgentSecondaryTrait);
        }
      } else if (value) {
        rejected.push(value);
      }
    }
    draft.fields.secondaryTraits = accepted;
    if (rejected.length > 0) {
      warnings.push({
        field: 'secondaryTraits',
        message: `AI suggested unsupported secondary trait(s): ${rejected.join(', ')} — dropped.`,
      });
    }
  }

  // Surface any model output keys outside the typed field set, never written.
  const knownKeys = new Set([
    'handle', 'displayName', 'concept', 'description',
    'scenario', 'greeting', 'primaryTrait', 'secondaryTraits',
  ]);
  const extraKeys = Object.keys(obj).filter((key) => !knownKeys.has(key));
  if (extraKeys.length > 0) {
    warnings.push({
      field: 'source',
      message: `AI returned extra field(s) not part of RealmAgent creation: ${extraKeys.join(', ')} — ignored.`,
    });
  }

  draft.warnings = warnings;
  draft.sourceLabel = 'AI-assisted generation';
  draft.updatedAt = Date.now();
  return draft;
}

/**
 * Generate a candidate RealmAgent draft from a free-text concept.
 *
 * Fail-closed: if no text route is configured, or generation fails, or the
 * model output cannot be parsed, returns `{ ok: false }` with a typed message
 * — never a fabricated draft.
 */
export async function generateRealmAgentDraft(
  worldId: string,
  concept: string,
): Promise<AiGenerationOutcome> {
  const description = concept.trim();
  if (!description) {
    return { ok: false, error: 'Describe the agent concept before generating a draft.' };
  }

  const binding = resolveTextBinding();
  if (!binding || !binding.model) {
    return {
      ok: false,
      error: 'No text model is configured for AI-assisted generation. Configure a text route first.',
    };
  }

  const route = (binding.source === 'cloud' ? 'cloud' : 'local') as NimiRoutePolicy;

  let result: { text?: string };
  try {
    result = await getRuntimeClient().ai.text.generate({
      model: binding.modelId || binding.model,
      input: `Concept: ${description}`,
      system: buildSystemPrompt(),
      route,
      connectorId: binding.connectorId || undefined,
      maxTokens: 1024,
      temperature: 0.8,
      timeoutMs: AI_GENERATION_TIMEOUT_MS,
      metadata: await buildRuntimeRequestMetadata({
        source: route,
        connectorId: binding.connectorId || undefined,
        providerEndpoint: binding.endpoint || undefined,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI generation failed.';
    return { ok: false, error: message };
  }

  const obj = extractJsonObject(String(result.text || ''));
  if (!obj) {
    return {
      ok: false,
      error: 'AI generation did not return a usable candidate. Try again or refine the concept.',
    };
  }

  return { ok: true, draft: generationObjectToDraft(worldId, description, obj) };
}
