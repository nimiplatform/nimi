import {
  type CanonicalMemoryView,
} from '@nimiplatform/sdk/runtime';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function summarizeCanonicalMemoryView(view: CanonicalMemoryView): string {
  const payload = view.record?.payload;
  switch (payload?.oneofKind) {
    case 'observational':
      return normalizeText(payload.observational.observation);
    case 'episodic':
      return normalizeText(payload.episodic.summary);
    case 'semantic':
      return [
        normalizeText(payload.semantic.subject),
        normalizeText(payload.semantic.predicate),
        normalizeText(payload.semantic.object),
      ].filter(Boolean).join(' ');
    default:
      return '';
  }
}
