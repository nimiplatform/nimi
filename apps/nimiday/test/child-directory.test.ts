import { describe, expect, it } from 'vitest';
import type { NimiAppActivityRecord } from '@nimiplatform/sdk/app';
import { childDirectory, CHILD_DIRECTORY_TYPE, withChildDirectory } from '../src/nimiday/domain/child-directory.js';

function snapshot(children: unknown, overrides: Partial<NimiAppActivityRecord> = {}): NimiAppActivityRecord {
  return {
    activityId: 'directory', key: 'child-directory', kind: 'activity',
    source: { kind: 'app', appId: 'nimi.parentos', displayName: 'ParentOS', sourceRef: 'src_one', available: true },
    type: CHILD_DIRECTORY_TYPE, data: { children }, revision: 1, changeSeq: '1',
    updatedAt: '2026-10-20T00:00:00Z', ...overrides,
  } as NimiAppActivityRecord;
}

describe('complete ParentOS child directory', () => {
  it('discovers every listed child without any reminder and never falls back to reminder groups', () => {
    const directory = childDirectory([snapshot([{ childId: 'a', childName: 'A' }, { childId: 'b', childName: 'B' }])]);
    expect(withChildDirectory([], directory)[0]?.groups.map(group => group.child?.childId)).toEqual(['a', 'b']);
    const old = withChildDirectory([], directory);
    expect(withChildDirectory(old, childDirectory([]))[0]?.groups).toEqual([]);
  });
  it('replaces renamed and deleted children, distinguishes a known empty list from a missing one', () => {
    const before = snapshot([{ childId: 'a', childName: 'A' }, { childId: 'b', childName: 'B' }]);
    const after = snapshot([{ childId: 'a', childName: 'New A' }], { revision: 2, changeSeq: '2' });
    expect(childDirectory([after, before]).groups.map(group => [group.key, group.child?.childName])).toEqual([['src_one\0child:a', 'New A']]);
    expect(childDirectory([snapshot([])])).toMatchObject({ sources: 1, groups: [], invalid: false });
    expect(childDirectory([]).sources).toBe(0);
  });
  it('rejects the entire malformed snapshot instead of offering a partial list', () => {
    for (const rows of [null, {}, [{ childId: 'a', childName: 'A' }, { childId: 'a', childName: 'B' }], [{ childId: 'a', childName: '' }]]) {
      expect(childDirectory([snapshot(rows)])).toMatchObject({ invalid: true, groups: [] });
    }
    expect(childDirectory([snapshot([], { key: 'another' })]).invalid).toBe(true);
  });
  it('keeps registration identity separate and makes unavailable sources non-addable', () => {
    const first = snapshot([{ childId: 'a', childName: 'Same name' }]);
    const other = snapshot([{ childId: 'a', childName: 'Same name' }], {
      source: { ...first.source, sourceRef: 'src_two', available: false },
    });
    const result = childDirectory([first, other]);
    expect(result.groups.map(group => [group.key, group.available])).toEqual([
      ['src_one\0child:a', true], ['src_two\0child:a', false],
    ]);
  });
});
