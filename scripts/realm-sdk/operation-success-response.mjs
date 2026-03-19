import { resolveOpenApiRef } from './openapi-ref.mjs';

function resolveResponse(spec, rawResponse) {
  if (!rawResponse || typeof rawResponse !== 'object') {
    return null;
  }
  if (rawResponse.$ref) {
    const resolved = resolveOpenApiRef(spec, rawResponse.$ref);
    return resolved && typeof resolved === 'object' ? resolved : null;
  }
  return rawResponse;
}

function isSuccessStatusCode(value) {
  return String(value || '').trim().toUpperCase().startsWith('2');
}

export function resolveOperationSuccessResponse(spec, operation) {
  const responses = operation?.responses;
  if (!responses || typeof responses !== 'object') {
    return {
      successStatusCodes: [],
      successContentTypes: [],
      hasSuccessBody: false,
    };
  }

  const successStatusCodes = [];
  const successContentTypes = new Set();
  let hasSuccessBody = false;

  for (const [statusCode, rawResponse] of Object.entries(responses)) {
    if (!isSuccessStatusCode(statusCode)) {
      continue;
    }
    successStatusCodes.push(String(statusCode));
    const response = resolveResponse(spec, rawResponse);
    const contentTypes = response?.content && typeof response.content === 'object'
      ? Object.keys(response.content)
      : [];
    for (const contentType of contentTypes) {
      successContentTypes.add(contentType);
    }
    if (contentTypes.length > 0) {
      hasSuccessBody = true;
    }
  }

  successStatusCodes.sort((left, right) => left.localeCompare(right));

  return {
    successStatusCodes,
    successContentTypes: Array.from(successContentTypes).sort((left, right) => left.localeCompare(right)),
    hasSuccessBody,
  };
}
