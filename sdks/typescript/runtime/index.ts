import type { CoreStreamRequest, CoreUnaryRequest } from '../types';
import { CoreClient } from '../core-client';

export class RuntimeCore {
  constructor(private readonly client: CoreClient) {}

  unary<Response = unknown, Body = unknown>(request: CoreUnaryRequest<Body>): Promise<Response> {
    return this.client.unary<Response, Body>(request);
  }

  serverStream<Response = unknown, Body = unknown>(request: CoreStreamRequest<Body>): AsyncIterable<Response> {
    return this.client.serverStream<Response, Body>(request);
  }
}

