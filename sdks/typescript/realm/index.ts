import type { CoreUnaryRequest } from '../types';
import { CoreClient } from '../core-client';

export interface RealmOperationRequest<Body = unknown> extends Omit<CoreUnaryRequest<Body>, 'methodId'> {
  readonly operationId: string;
}

export class RealmCore {
  constructor(private readonly client: CoreClient) {}

  operation<Response = unknown, Body = unknown>(request: RealmOperationRequest<Body>): Promise<Response> {
    return this.client.unary<Response, Body>({
      ...request,
      methodId: request.operationId,
    });
  }
}

