import type {
  TextGenerateInput,
  TextGenerateOutput,
} from '../runtime/index.js';
import {
  buildAppAiStructuredOutputRepairRequest,
  parseAppAiStructuredJson,
  type AppAiStructuredJsonParseInput,
  type AppAiStructuredOutputParseFailure,
  type AppAiStructuredOutputParseSuccess,
  type AppAiStructuredOutputRepairRequest,
} from './structured-output.js';

export type AppAiTextGenerateRuntime = {
  generateText: (request: TextGenerateInput) => Promise<TextGenerateOutput>;
};

export type AppAiTextGenerateStructuredOutput<TValue> = Omit<
  AppAiStructuredJsonParseInput<TValue>,
  'raw'
> & {
  required?: boolean;
  repairInstruction?: string;
};

export type AppAiTextGenerateInput<TStructured = unknown> = {
  runtime: AppAiTextGenerateRuntime;
  request: TextGenerateInput;
  structuredOutput?: AppAiTextGenerateStructuredOutput<TStructured>;
};

export type AppAiTextGenerateError = {
  code: string;
  message: string;
  cause?: unknown;
};

export type AppAiTextGenerateSuccess<TStructured = unknown> = {
  ok: true;
  text: string;
  output: TextGenerateOutput;
  structuredOutput?: AppAiStructuredOutputParseSuccess<TStructured>;
  structuredOutputFailure?: AppAiStructuredOutputParseFailure;
  repairRequest?: AppAiStructuredOutputRepairRequest;
};

export type AppAiTextGenerateFailure = {
  ok: false;
  error: AppAiTextGenerateError;
  output?: TextGenerateOutput;
  structuredOutputFailure?: AppAiStructuredOutputParseFailure;
  repairRequest?: AppAiStructuredOutputRepairRequest;
  canceled?: boolean;
};

export type AppAiTextGenerateResult<TStructured = unknown> =
  | AppAiTextGenerateSuccess<TStructured>
  | AppAiTextGenerateFailure;

export async function runAppAiTextGenerate<TStructured = unknown>(
  input: AppAiTextGenerateInput<TStructured>,
): Promise<AppAiTextGenerateResult<TStructured>> {
  let output: TextGenerateOutput;
  try {
    output = await input.runtime.generateText(input.request);
  } catch (error) {
    if (isAbortLikeError(error)) {
      return {
        ok: false,
        canceled: true,
        error: {
          code: 'OPERATION_ABORTED',
          message: 'Runtime text generation was canceled before completion.',
          cause: error,
        },
      };
    }
    return {
      ok: false,
      error: toAppAiTextGenerateError(error),
    };
  }

  const text = normalizeTextOutput(output.text);
  const structuredOutput = input.structuredOutput;
  if (!structuredOutput) {
    return {
      ok: true,
      text,
      output,
    };
  }

  const parsed = parseAppAiStructuredJson<TStructured>({
    raw: text,
    validate: structuredOutput.validate,
    expect: structuredOutput.expect,
  });
  if (parsed.ok) {
    return {
      ok: true,
      text,
      output,
      structuredOutput: parsed,
    };
  }

  const repairRequest = buildAppAiStructuredOutputRepairRequest({
    failure: parsed,
    originalText: text,
    instruction: structuredOutput.repairInstruction,
  });

  if (structuredOutput.required === false) {
    return {
      ok: true,
      text,
      output,
      structuredOutputFailure: parsed,
      repairRequest,
    };
  }

  return {
    ok: false,
    output,
    structuredOutputFailure: parsed,
    repairRequest,
    error: {
      code: 'STRUCTURED_OUTPUT_VALIDATION_FAILED',
      message: parsed.message,
      cause: parsed.error,
    },
  };
}

function toAppAiTextGenerateError(error: unknown): AppAiTextGenerateError {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const code = normalizeText(record.code) || normalizeText(record.reasonCode);
    const message = normalizeText(record.message);
    if (code || message) {
      return {
        code: code || 'RUNTIME_CALL_FAILED',
        message: message || 'Runtime text generation failed.',
        cause: error,
      };
    }
  }
  if (error instanceof Error) {
    return {
      code: error.name || 'RUNTIME_CALL_FAILED',
      message: error.message || 'Runtime text generation failed.',
      cause: error,
    };
  }
  return {
    code: 'RUNTIME_CALL_FAILED',
    message: String(error || 'Runtime text generation failed.'),
    cause: error,
  };
}

function isAbortLikeError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'AbortError';
  }
  if (error instanceof Error) {
    return error.name === 'AbortError' || error.message === 'Aborted';
  }
  return false;
}

function normalizeTextOutput(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
