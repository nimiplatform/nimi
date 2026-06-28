export class OpenAICompatibleGatewayError extends Error {
  constructor(code, message, status = 400, type = 'invalid_request_error') {
    super(message);
    this.name = 'OpenAICompatibleGatewayError';
    this.code = code;
    this.status = status;
    this.type = type;
  }
}
