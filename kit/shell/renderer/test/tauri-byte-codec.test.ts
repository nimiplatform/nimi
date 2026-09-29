import { describe, expect, it } from 'vitest';
import { resolveTauriInvokePayload, resolveTauriInvokeResult } from '../src/bridge/tauri-api.js';

// Tauri command IPC is JSON: exact byte views travel as JSON byte arrays on
// that carrier only, and its byte results return as byte views.
describe('Tauri JSON byte codec', () => {
  it('encodes exact byte views as their own byte range for the Tauri JSON wire', () => {
    const backing = new Uint8Array([9, 1, 2, 255, 9]);
    expect(resolveTauriInvokePayload('local_app_artifact_upload', {
      payload: { bytes: backing.subarray(1, 4), mimeType: 'image/png' },
    })).toEqual({ payload: { bytes: [1, 2, 255], mimeType: 'image/png' } });
    expect(resolveTauriInvokePayload('local_app_agent_commit_presentation', {
      payload: { importedAssets: [{ role: 'avatar', content: new Uint8Array([7]) }] },
    })).toEqual({ payload: { importedAssets: [{ role: 'avatar', content: [7] }] } });
    expect(resolveTauriInvokePayload('runtime_account_session_events_open', { afterSequence: '9' }))
      .toEqual({ payload: { afterSequence: '9' } });
  });

  it('restores byte results only for the Tauri byte commands and only for valid bytes', () => {
    expect(resolveTauriInvokeResult('local_app_agent_presentation_read_asset', { content: [1, 2, 255], role: 'avatar' }))
      .toEqual({ content: new Uint8Array([1, 2, 255]), role: 'avatar' });
    expect(resolveTauriInvokeResult('local_app_asset_read_next', { completed: false, bodyChunk: [0, 1] }))
      .toEqual({ completed: false, bodyChunk: new Uint8Array([0, 1]) });
    // An invalid array stays as it is, so the typed projection rejects it.
    expect(resolveTauriInvokeResult('local_app_asset_read_next', { completed: false, bodyChunk: [256] }))
      .toEqual({ completed: false, bodyChunk: [256] });
    expect(resolveTauriInvokeResult('local_app_text_generate_candidate', { values: [1, 2] }))
      .toEqual({ values: [1, 2] });
  });
});
