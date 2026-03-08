import { createNimiError } from '../errors.js';
import { ReasonCode } from '../../types/index.js';
import type { RuntimeWireMessage } from '../types.js';
import type {
  RuntimeStreamMethodCodec,
  RuntimeUnaryMethodCodec,
} from './method-codecs.js';

type BinarySerdeType<T> = {
  create(value?: Partial<T>): T;
  toBinary(message: T): RuntimeWireMessage;
  fromBinary(bytes: RuntimeWireMessage): T;
};

function asBinarySerdeType<T>(type: unknown): BinarySerdeType<T> {
  return type as BinarySerdeType<T>;
}

export function encodeRequest<Request>(
  methodId: string,
  codec: RuntimeUnaryMethodCodec<Request, unknown> | RuntimeStreamMethodCodec<Request, unknown>,
  request: Request,
): RuntimeWireMessage {
  try {
    const requestType = asBinarySerdeType<Request>(codec.requestType);
    const payload = requestType.create(request as Partial<Request>);
    return requestType.toBinary(payload);
  } catch (error) {
    throw createNimiError({
      message: `${methodId} request encode failed: ${error instanceof Error ? error.message : String(error)}`,
      reasonCode: ReasonCode.SDK_RUNTIME_REQUEST_ENCODE_FAILED,
      actionHint: 'validate_request_payload_against_proto',
      source: 'sdk',
    });
  }
}

export function decodeUnaryResponse<Response>(
  methodId: string,
  codec: RuntimeUnaryMethodCodec<unknown, Response>,
  payload: RuntimeWireMessage,
): Response {
  try {
    return asBinarySerdeType<Response>(codec.responseType).fromBinary(payload);
  } catch (error) {
    throw createNimiError({
      message: `${methodId} response decode failed: ${error instanceof Error ? error.message : String(error)}`,
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'check_transport_payload_contract',
      source: 'sdk',
    });
  }
}

export function decodeStreamEvent<Event>(
  methodId: string,
  codec: RuntimeStreamMethodCodec<unknown, Event>,
  payload: RuntimeWireMessage,
): Event {
  try {
    return asBinarySerdeType<Event>(codec.eventType).fromBinary(payload);
  } catch (error) {
    throw createNimiError({
      message: `${methodId} stream event decode failed: ${error instanceof Error ? error.message : String(error)}`,
      reasonCode: ReasonCode.SDK_RUNTIME_STREAM_DECODE_FAILED,
      actionHint: 'check_transport_payload_contract',
      source: 'sdk',
    });
  }
}
