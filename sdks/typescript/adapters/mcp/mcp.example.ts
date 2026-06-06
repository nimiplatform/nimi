import { createNimiMcpAdapter } from './index';

export const mcpAdapterExample = createNimiMcpAdapter({
  tools: [
    {
      name: 'echo',
      description: 'Echo JSON input.',
      inputSchema: {
        type: 'object',
      },
      visibility: 'model',
      policy: 'auto',
      execute(input) {
        return input;
      },
    },
  ],
});
