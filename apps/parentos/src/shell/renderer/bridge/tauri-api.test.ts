// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { hasTauriRuntime } from './tauri-api.js';

describe('hasTauriRuntime', () => {
  afterEach(() => {
    delete (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri;
  });

  it('treats the official Tauri runtime marker as available', () => {
    (globalThis as typeof globalThis & { isTauri?: boolean }).isTauri = true;
    expect(hasTauriRuntime()).toBe(true);
  });
});
