// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-043a

// Publisher safety declaration: `nimi.app.yaml.safety_profile` is the only
// author input. This module owns the closed vocabulary, the structural
// constraints, and the canonical serialization (key order, list order,
// deduplication) that every generated copy uses. It never fills, infers, or
// certifies a value; an absent declaration is "undeclared", not an empty
// risk list.

export const SAFETY_PROFILE_FIELD = 'safety_profile';
export const SAFETY_PROFILE_MAX_BYTES = 16 * 1024;

export const SAFETY_PROFILE_VOCABULARY = Object.freeze({
  intended_audience: Object.freeze(['children', 'general', 'teen', 'adult']),
  content_descriptors: Object.freeze([
    'sexual-content', 'violence', 'self-harm', 'drugs-alcohol', 'gambling',
    'hate-harassment', 'frightening-content', 'strong-language', 'unmoderated-shared-content',
  ]),
  risk_features: Object.freeze(['realistic-face-manipulation', 'realistic-voice-replication', 'emotion-recognition', 'biometric-categorization']),
  modality: Object.freeze(['text', 'image', 'audio', 'video', 'virtual-scene']),
  exposure: Object.freeze(['in-app-only', 'exportable', 'publishable']),
  publication_control: Object.freeze(['not-applicable', 'user-confirmed', 'automatic']),
  notice: Object.freeze(['present', 'absent', 'not-applicable']),
  marking: Object.freeze(['present', 'absent']),
  export_visible_marking: Object.freeze(['present', 'absent', 'not-applicable']),
  telemetry: Object.freeze(['crash-diagnostics', 'usage-analytics']),
  third_party_account: Object.freeze(['none', 'optional', 'required']),
  user_content_sharing: Object.freeze(['none', 'private', 'public']),
  commercial_features: Object.freeze(['purchase', 'subscription', 'advertising']),
  sensitive_data_categories: Object.freeze(['precise-location', 'contacts', 'health', 'financial', 'biometric', 'government-identifier']),
  high_impact_decision_uses: Object.freeze([
    'medical-diagnosis-treatment', 'legal-decision-support', 'employment-decision', 'education-admission-decision',
    'credit-insurance-decision', 'biometric-identification', 'public-safety-decision',
  ]),
});

const SUBJECT_NOTICE_TRIGGERS = new Set(['emotion-recognition', 'biometric-categorization']);

class SafetyProfileError extends Error {
  constructor(field, detail) {
    super(`${field} ${detail}`);
    this.name = 'SafetyProfileError';
    this.field = field;
  }
}

function fail(field, detail) {
  throw new SafetyProfileError(field, detail);
}

function object(value, field, required) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(field, 'must be an object');
  const allowed = new Set(required);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${field}.${key}`, 'is not a supported safety_profile field');
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${field}.${key}`, 'is required');
  return value;
}

function enumeration(value, field, vocabulary) {
  if (typeof value !== 'string' || !vocabulary.includes(value)) {
    fail(field, `must be one of ${vocabulary.join(', ')}`);
  }
  return value;
}

function boolean(value, field) {
  if (typeof value !== 'boolean') fail(field, 'must be true or false');
  return value;
}

function closedList(value, field, vocabulary) {
  if (!Array.isArray(value)) fail(field, 'must be an explicit list (empty is allowed)');
  const seen = new Set();
  for (const item of value) {
    enumeration(item, field, vocabulary);
    if (seen.has(item)) fail(field, `must not repeat ${item}`);
    seen.add(item);
  }
  // Tool-owned order: the closed vocabulary order, never author order.
  return vocabulary.filter((item) => seen.has(item));
}

function output(value, index) {
  const field = `${SAFETY_PROFILE_FIELD}.ai.outputs[${index}]`;
  object(value, field, ['modality', 'exposure', 'publication_control', 'in_product_notice', 'export_visible_marking', 'machine_readable_marking']);
  const modality = enumeration(value.modality, `${field}.modality`, SAFETY_PROFILE_VOCABULARY.modality);
  const exposure = enumeration(value.exposure, `${field}.exposure`, SAFETY_PROFILE_VOCABULARY.exposure);
  const publicationControl = enumeration(value.publication_control, `${field}.publication_control`, SAFETY_PROFILE_VOCABULARY.publication_control);
  if (exposure === 'publishable' ? publicationControl === 'not-applicable' : publicationControl !== 'not-applicable') {
    fail(`${field}.publication_control`, exposure === 'publishable' ? 'must be user-confirmed or automatic for publishable output' : 'must be not-applicable unless exposure is publishable');
  }
  const exportVisibleMarking = enumeration(value.export_visible_marking, `${field}.export_visible_marking`, SAFETY_PROFILE_VOCABULARY.export_visible_marking);
  if (exposure === 'in-app-only' ? exportVisibleMarking !== 'not-applicable' : exportVisibleMarking === 'not-applicable') {
    fail(`${field}.export_visible_marking`, exposure === 'in-app-only' ? 'must be not-applicable for in-app-only output' : 'must be present or absent for exportable or publishable output');
  }
  return {
    modality,
    exposure,
    publication_control: publicationControl,
    in_product_notice: enumeration(value.in_product_notice, `${field}.in_product_notice`, SAFETY_PROFILE_VOCABULARY.marking),
    export_visible_marking: exportVisibleMarking,
    machine_readable_marking: enumeration(value.machine_readable_marking, `${field}.machine_readable_marking`, SAFETY_PROFILE_VOCABULARY.marking),
  };
}

function ai(value) {
  const field = `${SAFETY_PROFILE_FIELD}.ai`;
  object(value, field, ['direct_interaction', 'interaction_notice', 'risk_features', 'subject_notice', 'outputs']);
  const directInteraction = boolean(value.direct_interaction, `${field}.direct_interaction`);
  const interactionNotice = enumeration(value.interaction_notice, `${field}.interaction_notice`, SAFETY_PROFILE_VOCABULARY.notice);
  if (directInteraction ? interactionNotice === 'not-applicable' : interactionNotice !== 'not-applicable') {
    fail(`${field}.interaction_notice`, directInteraction ? 'must be present or absent when direct_interaction is true' : 'must be not-applicable when direct_interaction is false');
  }
  const riskFeatures = closedList(value.risk_features, `${field}.risk_features`, SAFETY_PROFILE_VOCABULARY.risk_features);
  const subjectNotice = enumeration(value.subject_notice, `${field}.subject_notice`, SAFETY_PROFILE_VOCABULARY.notice);
  const subjectNoticeApplies = riskFeatures.some((item) => SUBJECT_NOTICE_TRIGGERS.has(item));
  if (subjectNoticeApplies ? subjectNotice === 'not-applicable' : subjectNotice !== 'not-applicable') {
    fail(`${field}.subject_notice`, subjectNoticeApplies ? 'must be present or absent when emotion-recognition or biometric-categorization is declared' : 'must be not-applicable without emotion-recognition or biometric-categorization');
  }
  if (!Array.isArray(value.outputs)) fail(`${field}.outputs`, 'must be an explicit list (empty is allowed)');
  const outputs = value.outputs.map(output);
  const modalities = new Set();
  for (const entry of outputs) {
    if (modalities.has(entry.modality)) fail(`${field}.outputs`, `must declare at most one entry for ${entry.modality}`);
    modalities.add(entry.modality);
  }
  outputs.sort((left, right) => SAFETY_PROFILE_VOCABULARY.modality.indexOf(left.modality) - SAFETY_PROFILE_VOCABULARY.modality.indexOf(right.modality));
  return { direct_interaction: directInteraction, interaction_notice: interactionNotice, risk_features: riskFeatures, subject_notice: subjectNotice, outputs };
}

function dataPractices(value) {
  const field = `${SAFETY_PROFILE_FIELD}.data_practices`;
  object(value, field, ['publisher_direct_external_network', 'telemetry', 'third_party_account', 'user_content_sharing', 'commercial_features', 'sensitive_data_categories']);
  return {
    publisher_direct_external_network: boolean(value.publisher_direct_external_network, `${field}.publisher_direct_external_network`),
    telemetry: closedList(value.telemetry, `${field}.telemetry`, SAFETY_PROFILE_VOCABULARY.telemetry),
    third_party_account: enumeration(value.third_party_account, `${field}.third_party_account`, SAFETY_PROFILE_VOCABULARY.third_party_account),
    user_content_sharing: enumeration(value.user_content_sharing, `${field}.user_content_sharing`, SAFETY_PROFILE_VOCABULARY.user_content_sharing),
    commercial_features: closedList(value.commercial_features, `${field}.commercial_features`, SAFETY_PROFILE_VOCABULARY.commercial_features),
    sensitive_data_categories: closedList(value.sensitive_data_categories, `${field}.sensitive_data_categories`, SAFETY_PROFILE_VOCABULARY.sensitive_data_categories),
  };
}

// Canonical form uses sorted object keys (matching the canonical JSON sidecar
// that Registry and Runtime consume) and closed-vocabulary list order.
function sortedKeys(value) {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedKeys(value[key])]));
}

// Returns the canonical declaration or throws naming the offending field.
// `undefined` input is not accepted here: callers decide what "absent" means.
export function normalizeSafetyProfile(value) {
  const field = SAFETY_PROFILE_FIELD;
  object(value, field, ['intended_audience', 'content_descriptors', 'ai', 'data_practices', 'high_impact_decision_uses']);
  const normalized = {
    intended_audience: enumeration(value.intended_audience, `${field}.intended_audience`, SAFETY_PROFILE_VOCABULARY.intended_audience),
    content_descriptors: closedList(value.content_descriptors, `${field}.content_descriptors`, SAFETY_PROFILE_VOCABULARY.content_descriptors),
    ai: ai(value.ai),
    data_practices: dataPractices(value.data_practices),
    high_impact_decision_uses: closedList(value.high_impact_decision_uses, `${field}.high_impact_decision_uses`, SAFETY_PROFILE_VOCABULARY.high_impact_decision_uses),
  };
  if (Buffer.byteLength(JSON.stringify(normalized)) > SAFETY_PROFILE_MAX_BYTES) fail(field, `exceeds ${SAFETY_PROFILE_MAX_BYTES} bytes`);
  return sortedKeys(normalized);
}

export function isCanonicalSafetyProfile(value) {
  try {
    return JSON.stringify(normalizeSafetyProfile(value)) === JSON.stringify(value);
  } catch {
    return false;
  }
}

// Field-level difference between two canonical declarations for review and
// display. Returns [] when both are absent or equal; an absent side is
// reported as `undeclared`.
export function diffSafetyProfiles(before, after) {
  const changes = [];
  const flatten = (value, prefix, into) => {
    if (Array.isArray(value)) {
      if (prefix.endsWith('.outputs')) {
        for (const entry of value) flatten(entry, `${prefix}[${entry.modality}]`, into);
      } else into.set(prefix, value.join(', ') || '[]');
      return;
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, into);
      return;
    }
    into.set(prefix, String(value));
  };
  const left = new Map();
  const right = new Map();
  if (before !== undefined && before !== null) flatten(before, '', left);
  if (after !== undefined && after !== null) flatten(after, '', right);
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const previous = left.has(key) ? left.get(key) : 'undeclared';
    const next = right.has(key) ? right.get(key) : 'undeclared';
    if (previous !== next) changes.push({ field: key, before: previous, after: next });
  }
  return changes.sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0));
}
