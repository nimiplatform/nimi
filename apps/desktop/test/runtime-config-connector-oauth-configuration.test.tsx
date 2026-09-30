import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';

import type {
  NimiManagedConnectorCredentialAcquisitionHostInput,
} from '@nimiplatform/sdk/runtime';

import {
  useConnectorOAuthAcquisition,
  useInvalidateManagedOAuthOnConfigurationChange,
} from '../src/shell/renderer/features/runtime-config/runtime-config-connector-oauth-session.js';
import {
  normalizeConnectorV11,
} from '../src/shell/renderer/features/runtime-config/runtime-config-state-types.js';

const SAVED_CONNECTOR = normalizeConnectorV11({
  id: 'connector-chatgpt-plan',
  label: 'user@example.com',
  vendor: 'openai',
  provider: 'openai_chatgpt_plan',
  authMode: 'oauth_managed',
  providerAuthProfile: 'openai_chatgpt_plan',
  endpoint: 'https://api.openai.com/v1',
  scope: 'user',
  hasCredential: true,
  isDraft: false,
});

type Harness = {
  start?: () => Promise<void>;
  busy?: boolean;
};

function OAuthHarness(props: {
  readonly configuration: string;
  readonly host: { acquireManagedConnectorCredential(input: NimiManagedConnectorCredentialAcquisitionHostInput): Promise<unknown> };
  readonly harness: Harness;
}) {
  const oauth = useConnectorOAuthAcquisition({
    host: props.host,
    findConnector: () => SAVED_CONNECTOR,
    onAcquired: () => undefined,
  });
  useInvalidateManagedOAuthOnConfigurationChange({
    busy: oauth.busy,
    configuration: props.configuration,
    invalidate: oauth.invalidate,
  });
  props.harness.start = () => oauth.start(SAVED_CONNECTOR);
  props.harness.busy = oauth.busy;
  return null;
}

// Sign in again on a saved Connector sets the operation busy; that alone must
// not count as a configuration change that abandons the sign-in it started.
test('starting a sign-in never cancels itself, while a configuration change still does', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' });
  const values: Record<string, unknown> = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    React, IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const { createRoot } = await import('react-dom/client');
  const calls: NimiManagedConnectorCredentialAcquisitionHostInput[] = [];
  const host = {
    acquireManagedConnectorCredential(input: NimiManagedConnectorCredentialAcquisitionHostInput) {
      calls.push(input);
      return new Promise<unknown>(() => undefined);
    },
  };
  const harness: Harness = {};
  const root = createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async () => root.render(<OAuthHarness configuration="initial" host={host} harness={harness} />));
    await act(async () => { void harness.start?.(); });
    assert.equal(calls.length, 1, 'the host received the sign-in request');
    assert.equal(harness.busy, true, 'the sign-in is still in progress after the busy render');
    assert.equal(calls[0]?.signal?.aborted, false, 'the busy render did not abandon the sign-in');

    await act(async () => root.render(<OAuthHarness configuration="changed" host={host} harness={harness} />));
    assert.equal(calls[0]?.signal?.aborted, true, 'a configuration change abandons the in-flight sign-in');
    assert.equal(harness.busy, false);
  } finally {
    await act(async () => root.unmount());
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
    dom.window.close();
  }
});
