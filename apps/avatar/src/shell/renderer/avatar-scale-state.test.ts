import { beforeEach, describe, expect, it } from 'vitest';
import {
  AVATAR_SCALE_DEFAULT,
  AVATAR_SCALE_MAX,
  AVATAR_SCALE_MIN,
  clampAvatarScale,
  readAvatarInstanceScale,
  resetAvatarInstanceScale,
  scaleStorageKeyForAvatarInstance,
  writeAvatarInstanceScale,
} from './avatar-scale-state.js';

beforeEach(() => {
  window.localStorage.clear();
});

describe('avatar-scale-state', () => {
  it('clamps and rounds avatar scale to the admitted policy range', () => {
    expect(clampAvatarScale(0.1)).toBe(AVATAR_SCALE_MIN);
    expect(clampAvatarScale(2.8)).toBe(AVATAR_SCALE_MAX);
    expect(clampAvatarScale(Number.NaN)).toBe(AVATAR_SCALE_DEFAULT);
    expect(clampAvatarScale(1.234)).toBe(1.23);
  });

  it('keys scale by avatar instance with explicit fixture/dev fallback', () => {
    expect(scaleStorageKeyForAvatarInstance({
      avatarInstanceId: 'avatar-01',
      fixtureId: 'fixture-a',
    })).toBe('avatar:avatar-01');
    expect(scaleStorageKeyForAvatarInstance({
      avatarInstanceId: null,
      fixtureId: 'fixture-a',
    })).toBe('fixture:fixture-a');
    expect(scaleStorageKeyForAvatarInstance({
      avatarInstanceId: null,
      fixtureId: null,
    })).toBe('dev:anonymous-avatar');
  });

  it('persists and resets scale per storage key', () => {
    writeAvatarInstanceScale('avatar:avatar-01', 1.42);
    writeAvatarInstanceScale('avatar:avatar-02', 0.72);

    expect(readAvatarInstanceScale('avatar:avatar-01')).toBe(1.42);
    expect(readAvatarInstanceScale('avatar:avatar-02')).toBe(0.72);

    resetAvatarInstanceScale('avatar:avatar-01');

    expect(readAvatarInstanceScale('avatar:avatar-01')).toBe(AVATAR_SCALE_DEFAULT);
    expect(readAvatarInstanceScale('avatar:avatar-02')).toBe(0.72);
  });
});
