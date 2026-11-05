import type { DemoZhiyuAgentClient } from '../components/demo-zhiyu-agent-center.js';

/** Visitor-session state for the same Local Agent across Home and App replicas. */
export function createDemoAgentClients() {
  const clients = new Map<string, DemoZhiyuAgentClient>();
  return {
    get(id: string, create: () => DemoZhiyuAgentClient) {
      let client = clients.get(id);
      if (!client) {
        client = create();
        clients.set(id, client);
      }
      return client;
    },
    clear() { clients.clear(); },
  };
}
