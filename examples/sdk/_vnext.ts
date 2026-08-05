import {
  collectNimiTextStream,
  createNimiClient,
  textPart,
  type NimiAiModel,
  type NimiClient,
  type CoreMetadata,
  type NimiGenerateTextResult,
  type NimiJsonObject,
  type NimiRunEvent,
} from '@nimiplatform/sdk';

export type ExampleClientInput = {
  appId: string;
  endpoint?: string;
  metadata?: CoreMetadata;
};

export type ExampleTextModelInput = {
  subjectUserId?: string;
  timeoutMs?: number;
  metadata?: NimiJsonObject;
};

export function runtimeEndpoint(): string {
  return String(process.env.NIMI_RUNTIME_GRPC_ENDPOINT || '127.0.0.1:46371').trim();
}

export function createExampleClient(input: ExampleClientInput): NimiClient {
  return createNimiClient({
    appId: input.appId,
    runtime: {
      transport: {
        type: 'node-grpc',
        endpoint: input.endpoint ?? runtimeEndpoint(),
      },
      metadata: input.metadata,
    },
  });
}

export function createExampleTextModel(
  client: NimiClient,
  input: ExampleTextModelInput = {},
): NimiAiModel {
  return client.ai.createRuntimeModel({
    subjectUserId: input.subjectUserId ?? 'local-user',
    timeoutMs: input.timeoutMs ?? 120_000,
    metadata: input.metadata,
  });
}

export function textRequest(prompt: string) {
  return {
    messages: [{
      role: 'user' as const,
      content: [textPart(prompt)],
    }],
  };
}

export async function generateExampleText(
  model: NimiAiModel,
  prompt: string,
): Promise<NimiGenerateTextResult> {
  return await model.generateText(textRequest(prompt));
}

export async function streamExampleText(
  model: NimiAiModel,
  prompt: string,
): Promise<AsyncIterable<NimiRunEvent>> {
  if (!model.streamText) {
    throw new Error('Runtime text capability does not expose streamText.');
  }
  return await model.streamText(textRequest(prompt));
}

export async function collectExampleTextStream(
  model: NimiAiModel,
  prompt: string,
): Promise<NimiGenerateTextResult> {
  return await collectNimiTextStream(await streamExampleText(model, prompt));
}
