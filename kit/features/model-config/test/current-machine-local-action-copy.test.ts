import { describe, expect, it } from 'vitest';
import {
  MODEL_CONFIG_CURRENT_MACHINE_LOCAL_ACTION_COPY,
  resolveModelConfigCurrentMachineLocalActionCopy,
} from '../src/current-machine-local-action-copy.js';

describe('Model Config current-machine Local action copy', () => {
  it('ships matching complete English and Chinese Kit-owned state catalogs', () => {
    expect(Object.keys(MODEL_CONFIG_CURRENT_MACHINE_LOCAL_ACTION_COPY.zh).sort()).toEqual(
      Object.keys(MODEL_CONFIG_CURRENT_MACHINE_LOCAL_ACTION_COPY.en).sort(),
    );
    expect(Object.values(MODEL_CONFIG_CURRENT_MACHINE_LOCAL_ACTION_COPY.en).every(Boolean)).toBe(true);
    expect(Object.values(MODEL_CONFIG_CURRENT_MACHINE_LOCAL_ACTION_COPY.zh).every(Boolean)).toBe(true);
  });

  it('resolves Chinese language tags and the English base', () => {
    expect(resolveModelConfigCurrentMachineLocalActionCopy('zh-CN').label).toBe('使用本机当前模型');
    expect(resolveModelConfigCurrentMachineLocalActionCopy('en-US').label).toBe('Use current on-device models');
    expect(resolveModelConfigCurrentMachineLocalActionCopy('zh').retryLabel).toBe('重试');
  });
});
