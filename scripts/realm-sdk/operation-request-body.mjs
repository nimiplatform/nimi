import { resolveOpenApiRef } from './openapi-ref.mjs';

export function resolveOperationRequestBody(spec, operation) {
  const body = operation?.requestBody?.$ref
    ? resolveOpenApiRef(spec, operation.requestBody.$ref)
    : operation?.requestBody;

  if (!body || typeof body !== 'object') {
    return {
      hasBody: false,
      bodyRequired: false,
      requestBodyContentType: '',
    };
  }

  const contentTypes = body.content && typeof body.content === 'object'
    ? Object.keys(body.content)
    : [];

  return {
    hasBody: contentTypes.length > 0,
    bodyRequired: Boolean(body.required),
    requestBodyContentType: contentTypes[0] || '',
  };
}
