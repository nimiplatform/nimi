import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import {
  GrantDock,
  grantCardGeometry,
  grantGeneratedDayLabel,
  selectGrantDockCards,
} from '../../src/shell/chrome/grant-dock.tsx';
import {
  ProductPresentationProvider,
  type PresentationGrant,
  type ProductEnginePorts,
} from '../../src/shell/chrome/product-presentation.tsx';
import {
  ShellActionsProvider,
  type ShellActions,
} from '../../src/shell/chrome/shell-actions.tsx';
import { UiProvider } from '../../src/shell/chrome/ui-context.tsx';
import type { SimulatorShellProductState } from '../../src/state-engine/product-state.ts';
import { simulatorOk } from '../../src/state-engine/errors.ts';

const simulatorRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function grant(
  id: string,
  status: PresentationGrant['status'],
  day: PresentationGrant['day'],
): PresentationGrant {
  return {
    id,
    status,
    day,
    title: id,
    scope: `${id} scope`,
    from: 'Desktop',
    to: '生态共享',
    meta: 'T+00:01',
    generatedDate: day === 'earlier' ? '2026-07-24' : '2026-07-27',
    tags: [],
    receipt: {
      access: '只读',
      range: '当前世界',
      validity: '本次会话',
      expiry: '',
      restriction: '无',
      lastUsed: '尚未使用',
    },
    seeded: true,
  };
}

test('grant dock shows every current-day receipt plus only unresolved earlier receipts', () => {
  const selected = selectGrantDockCards([
    grant('today-active', 'active', 'today'),
    grant('earlier-active', 'active', 'earlier'),
    grant('today-pending', 'pending', 'today'),
    grant('earlier-pending', 'pending', 'earlier'),
    grant('today-revoked', 'revoked', 'today'),
    grant('earlier-revoked', 'revoked', 'earlier'),
  ]);

  assert.deepEqual(
    selected.map((entry) => entry.id),
    ['earlier-pending', 'today-active', 'today-pending', 'today-revoked'],
  );
});

test('grant dock hover presents the targeted receipt enlarged and completely flat', () => {
  const active = grantCardGeometry(2, 2, 5);
  const left = grantCardGeometry(1, 2, 5);
  const right = grantCardGeometry(3, 2, 5);
  const farLeft = grantCardGeometry(0, 2, 5);

  assert.equal(active.rotateY, 0);
  assert.equal(active.rotateZ, 0);
  assert.equal(active.y, -62);
  assert.equal(active.z, 160);
  assert.equal(active.scale, 1.04);
  assert.equal(active.opacity, 1);
  assert.equal(left.z, -60);
  assert.equal(right.z, -60);
  assert.ok(left.opacity < 0.4);
  assert.ok(right.opacity < 0.4);
  assert.ok(active.y < left.y);
  assert.equal(left.y, right.y);
  assert.ok(left.y < farLeft.y);
  assert.ok(left.rotateZ < 0);
  assert.ok(right.rotateZ > 0);
  assert.ok(left.rotateY < active.rotateY);
  assert.ok(right.rotateY < active.rotateY);
  assert.ok(left.x < 72);
  assert.ok(right.x > 216);
});

test('grant dock rests as an aligned horizontal shelf of thick glass receipts', () => {
  const geometries = Array.from({ length: 4 }, (_, index) => grantCardGeometry(index, -1, 4));
  assert.deepEqual(geometries.map((entry) => entry.x), [0, 72, 144, 216]);
  assert.ok(geometries.every((entry) => entry.y === 0));
  assert.ok(geometries.every((entry) => entry.z === 0));
  assert.ok(geometries.every((entry) => entry.rotateY === -64));
  assert.ok(geometries.every((entry) => entry.rotateZ === 0));
  assert.ok(geometries.every((entry) => entry.scale === 0.88));
  assert.ok(geometries.every((entry, index) => index === 0 || entry.opacity < geometries[index - 1].opacity));
  assert.equal(geometries[0].opacity, 1);
  assert.ok(geometries.at(-1)!.opacity <= 0.48);
});

test('grant cards show the generated date for earlier unresolved grants', () => {
  assert.equal(grantGeneratedDayLabel(grant('earlier', 'pending', 'earlier')), '7月24日');
  assert.equal(grantGeneratedDayLabel(grant('today', 'pending', 'today')), '今天');
});

test('grant cards expose session validity as a read-only receipt field', () => {
  const source = readFileSync(
    path.join(simulatorRoot, 'src/shell/chrome/grant-dock.tsx'),
    'utf8',
  );

  assert.match(source, /className="grant-receipt-card__validity-label">有效期</u);
  assert.match(source, /className="grant-receipt-card__expiry"/u);
  assert.doesNotMatch(source, /调整时效|选择授权有效期|onAdjustValidity|GRANT_VALIDITY_OPTIONS/u);
});

test('pending grant actions remain clickable after the receipt opens', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://127.0.0.1/',
  });
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }

  const pending = grant('pending-click', 'pending', 'today');
  const product: SimulatorShellProductState = {
    persona: null,
    localAgentPresentation: { name: 'Nimi', kind: 'LocalAgent', mode: 'Runtime' },
    agent: { status: 'idle', location: 'cradle', carry: null },
    grants: [pending],
    ledger: [],
    consent: null,
    flow: { flowId: null, stepIndex: 0, status: 'idle', currentDirective: null },
    opSeq: 0,
  };
  const commandCalls: { readonly type: string; readonly payload: unknown }[] = [];
  const ports: ProductEnginePorts = {
    productState: () => product,
    productFlow: () => null,
    dispatchProductCommand: async (type, payload) => {
      commandCalls.push({ type, payload });
      return simulatorOk(null);
    },
    emitInteraction: async () => simulatorOk(null),
  };
  const actions: ShellActions = {
    epoch: 1,
    phase: 'open',
    route: { kind: 'home' },
    instances: [],
    modules: [],
    moduleCount: 0,
    open: () => {},
    close: () => {},
    activate: () => {},
    deactivate: () => {},
    navigate: () => {},
    reset: () => {},
  };

  const container = dom.window.document.getElementById('root');
  assert.ok(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(
      <UiProvider>
        <ShellActionsProvider value={actions}>
          <ProductPresentationProvider ports={ports}>
            <GrantDock />
          </ProductPresentationProvider>
        </ShellActionsProvider>
      </UiProvider>,
    ));
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label*="pending-click"]',
    );
    assert.ok(trigger);
    await act(async () => trigger.click());

    const approve = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '授权');
    assert.ok(approve);
    await act(async () => approve.click());
    assert.deepEqual(commandCalls, [{
      type: 'simulator.product.grant.resolve',
      payload: { grantId: 'pending-click', accept: true },
    }]);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test('hover ownership stays on a stationary slot while only the visual card transforms', () => {
  const source = readFileSync(
    path.join(simulatorRoot, 'src/shell/chrome/grant-dock.tsx'),
    'utf8',
  );
  const styles = readFileSync(
    path.join(simulatorRoot, 'src/shell/styles/grant-dock.css'),
    'utf8',
  );

  assert.match(
    source,
    /className="grant-receipt-slot"[\s\S]*?onPointerEnter=\{\(\) => onHover\(grant\.id\)\}/u,
  );
  assert.match(
    source,
    /className="grant-receipt-card"[\s\S]*?data-status=\{grant\.status\}/u,
  );
  assert.match(
    styles,
    /\.grant-receipt-slot\s*\{[^}]*transform:\s*translate3d\(var\(--grant-slot-x,[^}]*\}/su,
  );
  assert.match(
    styles,
    /\.grant-receipt-card\s*\{[\s\S]*?transform:\s*[\s\S]*?var\(--grant-card-y,[\s\S]*?\}/u,
  );
});

test('click reveals controls inside the selected receipt without a second detail card', () => {
  const source = readFileSync(
    path.join(simulatorRoot, 'src/shell/chrome/grant-dock.tsx'),
    'utf8',
  );
  const styles = readFileSync(
    path.join(simulatorRoot, 'src/shell/styles/grant-dock.css'),
    'utf8',
  );

  assert.match(
    source,
    /className="grant-receipt-slot__trigger"[\s\S]*?onClick=\{\(\) => onToggleDetail\(grant\.id\)\}/u,
  );
  assert.match(
    source,
    /const \[hoveredId, setHoveredId\][\s\S]*?const \[detailId, setDetailId\]/u,
  );
  assert.match(
    source,
    /className="grant-receipt-card"[\s\S]*?data-detail-open=\{detailOpen \|\| undefined\}[\s\S]*?id=\{`grant-actions-\$\{grant\.id\}`\}/u,
  );
  assert.match(
    styles,
    /\.grant-receipt-card\[data-detail-open\] \.grant-receipt-card__actions/u,
  );
  assert.match(
    styles,
    /\.grant-receipt-slot\[data-detail-open\]\s*>\s*\.grant-receipt-slot__trigger\s*\{[^}]*pointer-events:\s*none;/su,
  );
  assert.doesNotMatch(source, /GrantReceiptDetail/u);
  assert.doesNotMatch(source, /role="dialog"/u);
  assert.doesNotMatch(styles, /\.grant-receipt-detail/u);
});

test('grant receipt keeps the app identity and permission hierarchy legible over bright scene content', () => {
  const source = readFileSync(
    path.join(simulatorRoot, 'src/shell/chrome/grant-dock.tsx'),
    'utf8',
  );
  const styles = readFileSync(
    path.join(simulatorRoot, 'src/shell/styles/grant-dock.css'),
    'utf8',
  );

  assert.match(source, /<GrantSourceIcon grant=\{grant\} \/>/u);
  assert.match(
    source,
    /className="grant-receipt-card__title"[\s\S]*?className="grant-receipt-card__access"/u,
  );
  assert.doesNotMatch(source, /grant-receipt-card__scope/u);
  assert.match(source, /className="grant-receipt-card__time"/u);
  assert.match(
    styles,
    /--receipt-text-secondary:\s*rgba\(247,\s*250,\s*252,\s*0\.84\)/u,
  );
  assert.match(
    styles,
    /\.grant-receipt-card\s*\{[\s\S]*?width:\s*244px;[\s\S]*?height:\s*282px;[\s\S]*?linear-gradient\(152deg,\s*rgba\(48,\s*47,\s*53,\s*0\.96\),[\s\S]*?rgba\(10,\s*14,\s*19,\s*0\.98\)\)/u,
  );
  assert.match(
    styles,
    /\.grant-receipt-card__access\s*\{[\s\S]*?min-height:\s*47px;[\s\S]*?margin-top:\s*6px;/u,
  );
  assert.doesNotMatch(styles, /\.grant-receipt-card__scope/u);
  assert.match(
    styles,
    /\.grant-receipt-card::before\s*\{[\s\S]*?border-right-color:\s*rgba\(var\(--receipt-accent\),\s*0\.12\)[\s\S]*?inset -3px -4px 8px/u,
  );
  assert.match(
    styles,
    /\.grant-receipt-card\[data-active\]\s*\{[\s\S]*?linear-gradient\(152deg,\s*rgb\(48,\s*47,\s*53\),[\s\S]*?backdrop-filter:\s*none;/u,
  );
  assert.match(
    styles,
    /\.grant-receipt-card::after\s*\{[\s\S]*?rgba\(var\(--receipt-accent\),\s*0\.14\)[\s\S]*?opacity:\s*0\.48;/u,
  );
  assert.match(
    styles,
    /\.grant-receipt-card\[data-active\]\s*\{[\s\S]*?0 0 26px rgba\(var\(--receipt-accent\),\s*0\.1\);/u,
  );
});

test('the authorization dock scales uniformly without creating a new 3D transform context', () => {
  const styles = readFileSync(
    path.join(simulatorRoot, 'src/shell/styles/grant-dock.css'),
    'utf8',
  );

  assert.match(
    styles,
    /\.grant-dock\s*\{[\s\S]*?--grant-dock-scale:\s*0\.88;[\s\S]*?zoom:\s*var\(--grant-dock-scale\);/u,
  );
  assert.doesNotMatch(
    styles,
    /\.grant-dock\s*\{[^}]*transform:\s*scale/u,
  );
  assert.match(
    styles,
    /@media \(max-width:\s*760px\)[\s\S]*?--grant-dock-scale:\s*0\.74;/u,
  );
});
