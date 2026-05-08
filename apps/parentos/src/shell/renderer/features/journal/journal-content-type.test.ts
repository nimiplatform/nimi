import { describe, expect, it } from 'vitest';
import { resolveJournalContentType } from './journal-content-type.js';

describe('resolveJournalContentType', () => {
  it('marks text and photo payloads as mixed', () => {
    expect(resolveJournalContentType({
      textContent: 'Observed focused play.',
      voicePath: null,
      photoPaths: '["C:/photos/entry-1.jpg"]',
    })).toBe('mixed');
  });

  it('marks voice and photo payloads as mixed without transcript text', () => {
    expect(resolveJournalContentType({
      textContent: null,
      voicePath: 'C:/voice/entry-1.webm',
      photoPaths: '["C:/photos/entry-1.jpg"]',
    })).toBe('mixed');
  });

  it('keeps single-channel payloads on their concrete content type', () => {
    expect(resolveJournalContentType({ textContent: 'note', voicePath: null, photoPaths: null })).toBe('text');
    expect(resolveJournalContentType({ textContent: null, voicePath: 'C:/voice/entry-1.webm', photoPaths: null })).toBe('voice');
    expect(resolveJournalContentType({ textContent: null, voicePath: null, photoPaths: '["C:/photos/entry-1.jpg"]' })).toBe('photo');
  });

  it('fails closed when no content channel is present', () => {
    expect(() => resolveJournalContentType({ textContent: ' ', voicePath: null, photoPaths: null })).toThrow(/requires/);
  });
});
