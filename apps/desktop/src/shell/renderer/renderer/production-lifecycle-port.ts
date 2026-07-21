import { productionAppStore } from '../app-shell/providers/production-app-store.js';
import { productionQueryClient } from '../infra/query-client/production-query-client.js';
import { createDesktopRendererLifecyclePort } from './lifecycle-port.js';
import { productionDesktopI18n } from '../i18n/index.js';
import { createAgentConversationAnchorBindingStore } from '../app-shell/providers/agent-conversation-anchor-binding-storage.js';

/**
 * Transitional production host composition. Canonical factory invocations
 * create the same port from their instance-owned resources.
 */
export const productionRendererLifecyclePort = createDesktopRendererLifecyclePort(
  productionAppStore,
  productionQueryClient,
  (key, options) => String(productionDesktopI18n.instance.t(key, options)),
  createAgentConversationAnchorBindingStore(Date.now),
);
