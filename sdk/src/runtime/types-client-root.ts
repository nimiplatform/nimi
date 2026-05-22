import type {
  RuntimeAccountClient,
  RuntimeAgentClient,
  RuntimeAiClient,
  RuntimeAppAuthClient,
  RuntimeAppClient,
  RuntimeArtifactClient,
  RuntimeAuditClient,
  RuntimeAuthClient,
  RuntimeConnectorClient,
  RuntimeKnowledgeClient,
  RuntimeLocalServiceClient,
  RuntimeMemoryClient,
  RuntimeModelClient,
  RuntimeWorkflowClient,
} from './types-client-interfaces.js';
import type { RuntimeTransportConfig } from './types.js';

export type RuntimeClient = {
  appId: string;
  transport: RuntimeTransportConfig;
  auth: RuntimeAuthClient;
  appAuth: RuntimeAppAuthClient;
  account: RuntimeAccountClient;
  ai: RuntimeAiClient;
  artifact: RuntimeArtifactClient;
  workflow: RuntimeWorkflowClient;
  model: RuntimeModelClient;
  memory: RuntimeMemoryClient;
  agent: RuntimeAgentClient;
  local: RuntimeLocalServiceClient;
  connector: RuntimeConnectorClient;
  knowledge: RuntimeKnowledgeClient;
  app: RuntimeAppClient;
  audit: RuntimeAuditClient;
  closeStream(streamId: string): Promise<void>;
  close(): Promise<void>;
};
