import assert from 'node:assert/strict';
import test from 'node:test';
import { useUiExtensionContext } from '../src/desktop-adapter/slot-context.web.js';

test('slot-context.web returns stable default context', () => {
  const first = useUiExtensionContext();
  const second = useUiExtensionContext();

  assert.equal(first, second);
  assert.equal(first.activeTab, 'chat');
  assert.equal(first.shellUi.sidebarCollapsed, false);
  assert.equal(typeof first.setActiveTab, 'function');
});

test('slot-context.web applies sidebarCollapsed override without mutating default', () => {
  const defaultContext = useUiExtensionContext();
  const collapsed = useUiExtensionContext({ sidebarCollapsed: true });

  assert.notEqual(defaultContext, collapsed);
  assert.equal(collapsed.shellUi.sidebarCollapsed, true);
  assert.equal(defaultContext.shellUi.sidebarCollapsed, false);
});
