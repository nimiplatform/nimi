import type { JsonObject } from '../net/json';

export type ControlPlaneHttpErrorReasonCode =
  | 'control-plane/http-status'
  | 'control-plane/upstream-message'
  | 'control-plane/upstream-error'
  | 'control-plane/status-text';

export type ControlPlaneHttpError = Error & {
  code: 'CONTROL_PLANE_HTTP_ERROR';
  status: number;
  reasonCode: ControlPlaneHttpErrorReasonCode;
};

export type ControlPlaneContractErrorReasonCode =
  | 'control-plane/invalid-json'
  | 'control-plane/invalid-response';

export type ControlPlaneContractError = Error & {
  code: 'CONTROL_PLANE_CONTRACT_ERROR';
  reasonCode: ControlPlaneContractErrorReasonCode;
};

export function toControlPlaneHttpError(input: {
  status: number;
  statusText: string;
  payload: JsonObject | null;
}): Error {
  const payload = input.payload || {};
  const payloadMessage = typeof payload.message === 'string' ? payload.message.trim() : '';
  const payloadError = typeof payload.error === 'string' ? payload.error.trim() : '';
  const hasMessage = Boolean(payloadMessage);
  const hasError = Boolean(payloadError);
  const reasonCode: ControlPlaneHttpErrorReasonCode = hasMessage
    ? 'control-plane/upstream-message'
    : hasError
      ? 'control-plane/upstream-error'
      : input.statusText
        ? 'control-plane/status-text'
        : 'control-plane/http-status';
  const detail = (
    hasMessage
      ? payloadMessage
      : hasError
        ? payloadError
        : input.statusText
  ) || 'request failed';
  const error = new Error(`CONTROL_PLANE_HTTP_${input.status}: ${detail}`) as ControlPlaneHttpError;
  error.code = 'CONTROL_PLANE_HTTP_ERROR';
  error.status = input.status;
  error.reasonCode = reasonCode;
  return error;
}

export function toControlPlaneContractError(input: {
  reasonCode: ControlPlaneContractErrorReasonCode;
  detail: string;
}): Error {
  const error = new Error(`CONTROL_PLANE_CONTRACT_ERROR: ${input.detail}`) as ControlPlaneContractError;
  error.code = 'CONTROL_PLANE_CONTRACT_ERROR';
  error.reasonCode = input.reasonCode;
  return error;
}
