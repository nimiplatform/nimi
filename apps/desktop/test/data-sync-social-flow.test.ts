import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const profileFlowSource = readFileSync(
  resolve(import.meta.dirname, '../src/runtime/data-sync/flows/profile-flow.ts'),
  'utf8',
);

describe('D-DSYNC-004: social flow source scanning', () => {
  test('D-DSYNC-004: source includes requestOrAcceptFriend flow', () => {
    assert.ok(
      profileFlowSource.includes('export async function requestOrAcceptFriend'),
      'requestOrAcceptFriend must be exported from profile-flow',
    );
  });

  test('D-DSYNC-004: source includes blockUser flow', () => {
    assert.ok(
      profileFlowSource.includes('export async function blockUser'),
      'blockUser must be exported from profile-flow',
    );
  });

  test('D-DSYNC-004: source includes unblockUser flow', () => {
    assert.ok(
      profileFlowSource.includes('export async function unblockUser'),
      'unblockUser must be exported from profile-flow',
    );
  });

  test('D-DSYNC-004: source includes removeFriend flow', () => {
    assert.ok(
      profileFlowSource.includes('export async function removeFriend'),
      'removeFriend must be exported from profile-flow',
    );
  });
});
