/**
 * DeepSeek Chat Tutorial (single-file, no wrapper)
 *
 * Flow:
 * 1) save api key -> connectorId
 * 2) generate text with connectorId
 * 3) desktop/app layer resolves connectorId -> key, runtime only receives request metadata
 *
 * Required env:
 * - NIMI_DEEPSEEK_API_KEY=sk-xxx
 *
 * Optional env:
 * - NIMI_RUNTIME_GRPC_ENDPOINT=127.0.0.1:46371
 * - NIMI_APP_ID=example.providers.deepseek
 * - NIMI_SUBJECT_USER_ID=local-user
 * - NIMI_DEEPSEEK_ENDPOINT=https://api.deepseek.com
 * - NIMI_DEEPSEEK_CHAT_MODEL=nimillm/deepseek-chat
 * - NIMI_DEEPSEEK_CHAT_PROMPT="Explain runtime credential flow"
 */

import { Runtime } from '@nimiplatform/sdk';
import { randomUUID } from 'node:crypto';

const MODAL_TEXT = 1;
const ROUTE_POLICY_TOKEN_API = 2;
const FALLBACK_POLICY_DENY = 1;

type SavedConnector = {
  connectorId: string;
  provider: 'deepseek';
  endpoint: string;
  apiKey: string;
};

const connectorStore = new Map<string, SavedConnector>();

function env(name: string, fallback = ''): string {
  const value = String(process.env[name] || '').trim();
  return value || fallback;
}

function requiredEnv(name: string): string {
  const value = env(name);
  if (!value) {
    throw new Error(`Missing env: ${name}`);
  }
  return value;
}

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

function saveDeepseekConnector(input: {
  endpoint: string;
  apiKey: string;
}): string {
  const connectorId = `connector_${randomUUID()}`;
  connectorStore.set(connectorId, {
    connectorId,
    provider: 'deepseek',
    endpoint: String(input.endpoint || '').trim(),
    apiKey: String(input.apiKey || '').trim(),
  });
  return connectorId;
}

function resolveConnector(connectorId: string): SavedConnector {
  const connector = connectorStore.get(connectorId);
  if (!connector) {
    throw new Error(`connector not found: ${connectorId}`);
  }
  if (!connector.apiKey) {
    throw new Error(`connector api key missing: ${connectorId}`);
  }
  return connector;
}

function extractText(output: unknown): string {
  const content = (output as {
    fields?: {
      content?: {
        listValue?: {
          values?: Array<{
            structValue?: {
              fields?: {
                text?: { stringValue?: string };
              };
            };
          }>;
        };
      };
      text?: {
        stringValue?: string;
        kind?: {
          stringValue?: string;
        };
      };
    };
  })?.fields;
  const directText = String(content?.text?.stringValue || content?.text?.kind?.stringValue || '').trim();
  if (directText) {
    return directText;
  }
  const values = content?.content?.listValue?.values || [];
  const joined = values
    .map((item) => String(item?.structValue?.fields?.text?.stringValue || '').trim())
    .filter((value) => value.length > 0)
    .join(' ')
    .trim();
  if (joined) {
    return joined;
  }
  return '';
}

async function main(): Promise<void> {
  const endpoint = env('NIMI_RUNTIME_GRPC_ENDPOINT', '127.0.0.1:46371');
  const appId = env('NIMI_APP_ID', 'example.providers.deepseek');
  const subjectUserId = env('NIMI_SUBJECT_USER_ID', 'local-user');
  const model = env('NIMI_DEEPSEEK_CHAT_MODEL', 'nimillm/deepseek-chat');
  const prompt = env('NIMI_DEEPSEEK_CHAT_PROMPT', 'Give me a concise 3-line intro to Nimi runtime.');

  const connectorId = saveDeepseekConnector({
    endpoint: env('NIMI_DEEPSEEK_ENDPOINT', 'https://api.deepseek.com'),
    apiKey: requiredEnv('NIMI_DEEPSEEK_API_KEY'),
  });

  const runtime = new Runtime({
    appId,
    transport: {
      type: 'node-grpc',
      endpoint,
    },
    defaults: {
      callerKind: 'desktop-core',
      callerId: 'docs-example-provider',
    },
  });

  const connector = resolveConnector(connectorId);
  const response = await runtime.ai.generate({
    appId,
    subjectUserId,
    modelId: model,
    modal: MODAL_TEXT,
    input: [{ role: 'user', content: prompt, name: '' }],
    systemPrompt: '',
    tools: [],
    temperature: 0.7,
    topP: 1,
    maxTokens: 512,
    routePolicy: ROUTE_POLICY_TOKEN_API,
    fallback: FALLBACK_POLICY_DENY,
    timeoutMs: 120000,
  }, {
    metadata: {
      keySource: 'inline',
      providerEndpoint: connector.endpoint,
      providerApiKey: connector.apiKey,
    } as any,
  });
  const text = extractText(response.output);
  if (!text) {
    throw new Error('deepseek chat returned empty text');
  }

  log(`[deepseek-chat] runtime grpc endpoint: ${endpoint}`);
  log(`[deepseek-chat] connectorId: ${connectorId}`);
  log(`[deepseek-chat] model: ${model}`);
  log(`[deepseek-chat][output] ${text}`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  process.stderr.write(`[example-error] ${message}\n`);
  process.exitCode = 1;
}
