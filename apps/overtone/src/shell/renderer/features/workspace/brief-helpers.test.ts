import { describe, it, expect } from 'vitest';
import { parseBriefJson, buildBriefContext } from './brief-panel.js';

describe('parseBriefJson', () => {
  it('parses valid JSON brief', () => {
    const result = parseBriefJson('{"title":"Test","genre":"pop","mood":"happy","tempo":"fast","description":"desc"}');
    expect(result).toEqual({
      title: 'Test',
      genre: 'pop',
      mood: 'happy',
      tempo: 'fast',
      description: 'desc',
    });
  });

  it('strips markdown code fences', () => {
    const result = parseBriefJson('```json\n{"title":"Test","genre":"","mood":"","tempo":"","description":""}\n```');
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Test');
  });

  it('truncates title to 50 chars', () => {
    const longTitle = 'A'.repeat(100);
    const result = parseBriefJson(`{"title":"${longTitle}","genre":"","mood":"","tempo":"","description":""}`);
    expect(result!.title).toHaveLength(50);
  });

  it('returns null for invalid JSON', () => {
    expect(parseBriefJson('not json')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseBriefJson('')).toBeNull();
  });

  it('coerces missing fields to empty strings', () => {
    const result = parseBriefJson('{}');
    expect(result).toEqual({
      title: '',
      genre: '',
      mood: '',
      tempo: '',
      description: '',
    });
  });
});

describe('buildBriefContext', () => {
  it('builds context from brief and idea', () => {
    const brief = { title: 'Song', genre: 'pop', mood: 'happy', tempo: 'fast', description: 'A pop song' };
    const result = buildBriefContext(brief, 'my idea');
    expect(result).toContain('Idea: my idea');
    expect(result).toContain('Title: Song');
    expect(result).toContain('Genre: pop');
  });

  it('returns trimmed idea when no brief', () => {
    expect(buildBriefContext(null, '  my idea  ')).toBe('my idea');
  });

  it('returns empty string for null brief and empty idea', () => {
    expect(buildBriefContext(null, '')).toBe('');
  });
});
