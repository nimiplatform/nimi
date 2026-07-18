import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  APP_ACCESS_STATES,
  APP_INVENTORY_PRESENCE_STATES,
  deriveAppCardState,
  postureForAppCardState,
} from '../src/shell/renderer/features/apps/apps-card-state.js';
import { actionPlanForInventoryEntry } from '../src/shell/renderer/features/apps/apps-card-actions.js';
import { accountRow, inventoryEntry, localRecord } from './apps-read-only-fixtures.js';

describe('Desktop Apps read-only state dimensions', () => {
  it('keeps catalog, account, and local-record presence distinct', () => {
    const states = [
      deriveAppCardState(inventoryEntry()).inventory,
      deriveAppCardState(inventoryEntry({ sources: { account: { status: 'present', value: accountRow } } })).inventory,
      deriveAppCardState(inventoryEntry({ sources: { localRecord: { status: 'present', value: localRecord('active') } } })).inventory,
      deriveAppCardState(inventoryEntry({ sources: { localRecord: { status: 'present', value: localRecord('dormant') } } })).inventory,
      deriveAppCardState(inventoryEntry({ sources: { localRecord: { status: 'present', value: localRecord('removed') } } })).inventory,
    ];
    assert.deepEqual(states, [...APP_INVENTORY_PRESENCE_STATES]);
  });

  it('maps every SDK access posture without inventing package success', () => {
    const readiness = [
      'ready',
      'sign-in-required',
      'package-unavailable',
      'local-record-dormant',
      'blocked-by-master-gate',
      'unsupported',
    ] as const;
    const states = readiness.map((openReadiness) => deriveAppCardState(inventoryEntry({ openReadiness })).access);
    assert.deepEqual(states, [...APP_ACCESS_STATES]);
  });

  it('preserves the global immutable-package posture and degraded source identity', () => {
    const state = deriveAppCardState(inventoryEntry({
      sources: {
        account: { status: 'degraded', reasonCode: 'ACCOUNT_RUNTIME_UNAVAILABLE' },
        packageReadiness: { status: 'degraded', reasonCode: ReasonCode.RUNTIME_UNAVAILABLE },
      },
    }));
    assert.equal(state.immutablePackage, 'immutable_package_unavailable');
    assert.equal(state.packageProjectionStatus, 'degraded');
    assert.deepEqual(state.degradedSources, ['account', 'packageReadiness']);
  });

  it('uses normal posture only for an active, ready local record', () => {
    const active = deriveAppCardState(inventoryEntry({
      openReadiness: 'ready',
      installState: 'local-record-active',
      sources: { localRecord: { status: 'present', value: localRecord('active') } },
    }));
    assert.equal(postureForAppCardState(active), 'normal');
    assert.equal(postureForAppCardState(deriveAppCardState(inventoryEntry())), 'disabled');
  });
});

describe('Desktop Apps action plan', () => {
  it('exposes details only for ordinary inventory rows', () => {
    assert.deepEqual(actionPlanForInventoryEntry(inventoryEntry()), {
      primary: null,
      secondary: [{ id: 'details' }],
    });
  });

  it('adds only the Desktop account sign-in route when required', () => {
    assert.deepEqual(actionPlanForInventoryEntry(inventoryEntry({
      openReadiness: 'sign-in-required',
      nextActions: ['sign-in'],
    })), {
      primary: { id: 'sign_in' },
      secondary: [{ id: 'details' }],
    });
  });

  it('does not project SDK open hints into Apps package actions', () => {
    assert.deepEqual(actionPlanForInventoryEntry(inventoryEntry({
      nextActions: ['open'],
    })), {
      primary: null,
      secondary: [{ id: 'details' }],
    });
  });
});
