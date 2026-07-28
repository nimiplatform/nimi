import * as grpc from '@grpc/grpc-js';
import { BinaryWriter, WireType } from '@protobuf-ts/runtime';
import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '../types';
import { normalizeServiceError } from './node-grpc-errors';

type ErrorInfoInput = {
  readonly reason: string;
  readonly domain?: string;
  readonly metadata?: Readonly<Record<string, string>>;
};

function encodeErrorInfo(input: ErrorInfoInput): Uint8Array {
  const writer = new BinaryWriter();
  writer.tag(1, WireType.LengthDelimited).string(input.reason);
  writer.tag(2, WireType.LengthDelimited).string(input.domain ?? 'nimi.runtime.v1');
  for (const [key, value] of Object.entries(input.metadata ?? {})) {
    const entryWriter = new BinaryWriter();
    entryWriter.tag(1, WireType.LengthDelimited).string(key);
    entryWriter.tag(2, WireType.LengthDelimited).string(value);
    writer.tag(3, WireType.LengthDelimited).bytes(entryWriter.finish());
  }
  return writer.finish();
}

function encodeAny(typeUrl: string, value: Uint8Array): Uint8Array {
  const writer = new BinaryWriter();
  writer.tag(1, WireType.LengthDelimited).string(typeUrl);
  writer.tag(2, WireType.LengthDelimited).bytes(value);
  return writer.finish();
}

function encodeStatus(
  code: grpc.status,
  message: string,
  errorInfo: ErrorInfoInput,
): Uint8Array {
  const writer = new BinaryWriter();
  writer.tag(1, WireType.Varint).int32(code);
  writer.tag(2, WireType.LengthDelimited).string(message);
  writer.tag(3, WireType.LengthDelimited).bytes(encodeAny(
    'type.googleapis.com/google.rpc.ErrorInfo',
    encodeErrorInfo(errorInfo),
  ));
  return writer.finish();
}

function createServiceError(
  code: grpc.status,
  details: string,
  statusDetails?: Uint8Array,
): grpc.ServiceError {
  const metadata = new grpc.Metadata();
  if (statusDetails) {
    metadata.set('grpc-status-details-bin', Buffer.from(statusDetails));
  }
  return Object.assign(new Error(details), {
    code,
    details,
    metadata,
  }) as grpc.ServiceError;
}

test('normalizeServiceError decodes nimi ErrorInfo fields from grpc-status-details-bin', () => {
  const publicMessage = 'Provider request failed without exposing its payload';
  const error = createServiceError(
    grpc.status.UNAVAILABLE,
    publicMessage,
    encodeStatus(grpc.status.UNAVAILABLE, publicMessage, {
      reason: ReasonCode.AI_PROVIDER_TIMEOUT,
      metadata: {
        action_hint: 'retry_or_check_provider_endpoint',
        trace_id: 'trace-sdk-errorinfo',
        retryable: 'false',
      },
    }),
  );

  const normalized = normalizeServiceError(grpc, error);

  assert.equal(normalized.reasonCode, ReasonCode.AI_PROVIDER_TIMEOUT);
  assert.equal(normalized.code, ReasonCode.AI_PROVIDER_TIMEOUT);
  assert.equal(normalized.actionHint, 'retry_or_check_provider_endpoint');
  assert.equal(normalized.traceId, 'trace-sdk-errorinfo');
  assert.equal(normalized.retryable, false);
  assert.equal(normalized.message, publicMessage);
  assert.deepEqual(normalized.details, {
    grpcCode: grpc.status.UNAVAILABLE,
    grpcDetails: publicMessage,
  });
});

test('normalizeServiceError treats ErrorInfo as canonical over status message text', () => {
  const publicMessage = 'Canonical provider output failure';
  const misleadingMessage = JSON.stringify({
    reasonCode: ReasonCode.AI_INPUT_INVALID,
    actionHint: 'trust_status_message',
    retryable: true,
    message: publicMessage,
  });
  const error = createServiceError(
    grpc.status.INTERNAL,
    misleadingMessage,
    encodeStatus(grpc.status.INTERNAL, misleadingMessage, {
      reason: ReasonCode.AI_OUTPUT_INVALID,
      metadata: {
        action_hint: 'inspect_provider_response',
        retryable: 'false',
      },
    }),
  );

  const normalized = normalizeServiceError(grpc, error);

  assert.equal(normalized.reasonCode, ReasonCode.AI_OUTPUT_INVALID);
  assert.equal(normalized.actionHint, 'inspect_provider_response');
  assert.equal(normalized.retryable, false);
  assert.equal(normalized.message, publicMessage);
});

test('normalizeServiceError does not infer ReasonCode from status text without ErrorInfo', () => {
  const error = createServiceError(
    grpc.status.INTERNAL,
    `${ReasonCode.AI_PROVIDER_TIMEOUT}: provider timed out`,
  );

  const normalized = normalizeServiceError(grpc, error);

  assert.equal(normalized.reasonCode, 'RUNTIME_GRPC_INTERNAL');
  assert.equal(normalized.code, 'RUNTIME_GRPC_INTERNAL');
  assert.equal(normalized.actionHint, 'check_request_and_app_auth');
  assert.equal(normalized.retryable, false);
});

test('normalizeServiceError falls back safely when grpc-status-details-bin is malformed', () => {
  const error = createServiceError(
    grpc.status.INTERNAL,
    JSON.stringify({
      reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
      actionHint: 'trust_status_message',
      traceId: 'forged-trace',
      retryable: true,
    }),
    Uint8Array.of(0xff),
  );

  const normalized = normalizeServiceError(grpc, error);

  assert.equal(normalized.reasonCode, 'RUNTIME_GRPC_INTERNAL');
  assert.equal(normalized.actionHint, 'check_request_and_app_auth');
  assert.equal(normalized.traceId, '');
  assert.equal(normalized.retryable, false);
});

test('normalizeServiceError rejects foreign ErrorInfo domains', () => {
  const publicMessage = 'foreign structured error';
  const error = createServiceError(
    grpc.status.RESOURCE_EXHAUSTED,
    publicMessage,
    encodeStatus(grpc.status.RESOURCE_EXHAUSTED, publicMessage, {
      reason: ReasonCode.AI_PROVIDER_TIMEOUT,
      domain: 'foreign.runtime.v1',
      metadata: {
        action_hint: 'trust_foreign_domain',
        retryable: 'false',
      },
    }),
  );

  const normalized = normalizeServiceError(grpc, error);

  assert.equal(normalized.reasonCode, 'RUNTIME_GRPC_RESOURCE_EXHAUSTED');
  assert.equal(normalized.actionHint, 'retry_or_check_runtime_daemon');
  assert.equal(normalized.retryable, true);
});

test('normalizeServiceError rejects over-bounded ErrorInfo recovery metadata', () => {
  const publicMessage = 'bounded error';
  const error = createServiceError(
    grpc.status.INTERNAL,
    publicMessage,
    encodeStatus(grpc.status.INTERNAL, publicMessage, {
      reason: ReasonCode.AI_PROVIDER_TIMEOUT,
      metadata: {
        action_hint: 'a'.repeat(257),
      },
    }),
  );

  const normalized = normalizeServiceError(grpc, error);

  assert.equal(normalized.reasonCode, 'RUNTIME_GRPC_INTERNAL');
  assert.equal(normalized.actionHint, 'check_request_and_app_auth');
});
