import React from 'react';
import { createHookClient } from '@nimiplatform/sdk/mod/hook';
import { createModRuntimeClient } from '@nimiplatform/sdk/mod/runtime';
import type { RuntimeModRegistration } from '@nimiplatform/sdk/mod/types';

const MOD_ID = 'world.example.hello-mod';
const NAV_SLOT = 'ui-extension.app.sidebar.mods';
const ROUTE_SLOT = 'ui-extension.app.content.routes';
const TAB_ID = 'mod:world.example.hello-mod';

function HelloModPage() {
  return React.createElement(
    'div',
    {
      className: 'm-4 rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700 shadow-sm',
    },
    [
      React.createElement(
        'h2',
        {
          key: 'title',
          className: 'text-lg font-semibold text-gray-900',
        },
        'Hello Mod',
      ),
      React.createElement(
        'p',
        {
          key: 'body',
          className: 'mt-2',
        },
        'This page is loaded from a third-party runtime mod template.',
      ),
    ],
  );
}

export function createRuntimeMod(): RuntimeModRegistration {
  return {
    modId: MOD_ID,
    capabilities: ['ui'],
    setup: async ({ sdkRuntimeContext }) => {
      const hookClient = createHookClient(MOD_ID, sdkRuntimeContext);
      const runtimeClient = createModRuntimeClient(MOD_ID, sdkRuntimeContext);
      await hookClient.ui.register({
        slot: NAV_SLOT,
        priority: 150,
        extension: {
          type: 'nav-item',
          tabId: TAB_ID,
          label: 'Hello Mod',
          icon: 'puzzle',
          strategy: 'append',
        },
      });
      await hookClient.ui.register({
        slot: ROUTE_SLOT,
        priority: 150,
        extension: {
          type: 'tab-page',
          tabId: TAB_ID,
          strategy: 'append',
          component: HelloModPage,
        },
      });
      void runtimeClient;
    },
  };
}
