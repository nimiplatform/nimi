export class P4HarnessError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'P4HarnessError';
    this.code = code;
  }
}

export function safeHarnessFailure(error, fallbackCode = 'P4_GATE_WORKER_FAILED') {
  return {
    code: String(error?.code || fallbackCode),
    name: error instanceof Error ? error.name : 'Error',
    message: String(error instanceof Error ? error.message : error).slice(0, 4_096),
  };
}
