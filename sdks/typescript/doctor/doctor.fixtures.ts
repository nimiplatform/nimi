export const VERCEL_APP_FIXTURE = `
import { generateText, streamText, tool } from 'ai';
import { z } from 'zod';

const weather = tool({
  description: 'get weather',
  inputSchema: z.object({ city: z.string() }),
  execute: async ({ city }) => ({ city, temp: 21 }),
});

export async function answer(model: unknown, question: string) {
  const result = await generateText({
    model,
    prompt: question,
    tools: { weather },
    providerOptions: { anthropic: {} },
  });
  return result.text;
}

export async function answerStreaming(model: unknown, question: string) {
  const stream = streamText({ model, prompt: question, includeRawChunks: true });
  return stream;
}
`;

export const MASTRA_APP_FIXTURE = `
import { Agent, createTool } from '@mastra/core';
import { Memory } from '@mastra/memory';

const lookup = createTool({
  id: 'lookup',
  execute: async () => 'found',
});

const memory = new Memory({ storage: undefined });

const agent = new Agent({
  name: 'helper',
  model: {},
  tools: { lookup },
  memory,
});

export async function run(question: string) {
  const reply = await agent.generate(question, {
    structuredOutput: { schema: {} },
    abortSignal: new AbortController().signal,
  });
  await agent.unknownExperimentalThing({ flag: true });
  return reply;
}
`;

export const OPENAI_APP_FIXTURE = `
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: 'sk-test' });

export async function chat(prompt: string) {
  const completion = await client.chat.completions.create({
    model: 'gpt-test',
    messages: [{ role: 'user', content: prompt }],
    tools: [],
  });
  const embeddings = await client.embeddings.create({ model: 'embed', input: prompt });
  return { completion, embeddings };
}
`;

export const PENDING_FRAMEWORK_FIXTURE = `
import { StateGraph } from '@langchain/langgraph';

export function build() {
  return new StateGraph({});
}
`;

export const NO_FRAMEWORK_FIXTURE = `
export function pure(value: number): number {
  return value * 2;
}
`;
