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

export function toControlPlaneHttpError(input: {
  status: number;
  statusText: string;
  payload: Record<string, unknown> | null;
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
