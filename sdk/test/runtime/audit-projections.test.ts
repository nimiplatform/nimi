import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  CallerKind,
  UsageWindow,
  projectRuntimeAuditCallerKindName,
  projectRuntimeUsageWindowName,
} from '../../src/runtime/index.js';

describe('Runtime audit projections', () => {
  test('projects caller kind wire enum values to SDK names', () => {
    assert.equal(projectRuntimeAuditCallerKindName(CallerKind.DESKTOP_CORE), 'DESKTOP_CORE');
    assert.equal(projectRuntimeAuditCallerKindName(CallerKind.THIRD_PARTY_APP), 'THIRD_PARTY_APP');
    assert.equal(projectRuntimeAuditCallerKindName(CallerKind.THIRD_PARTY_SERVICE), 'THIRD_PARTY_SERVICE');
    assert.equal(projectRuntimeAuditCallerKindName(CallerKind.UNSPECIFIED), undefined);
    assert.equal(projectRuntimeAuditCallerKindName(2), undefined);
    assert.equal(projectRuntimeAuditCallerKindName(99), undefined);
  });

  test('projects usage window wire enum values to SDK names', () => {
    assert.equal(projectRuntimeUsageWindowName(UsageWindow.MINUTE), 'MINUTE');
    assert.equal(projectRuntimeUsageWindowName(UsageWindow.HOUR), 'HOUR');
    assert.equal(projectRuntimeUsageWindowName(UsageWindow.DAY), 'DAY');
    assert.equal(projectRuntimeUsageWindowName(UsageWindow.UNSPECIFIED), undefined);
    assert.equal(projectRuntimeUsageWindowName(99), undefined);
  });
});
