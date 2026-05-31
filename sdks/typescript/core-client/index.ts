import type { CoreStreamRequest, CoreUnaryRequest } from '../types';

export interface CoreTransport {
  unary<Response = unknown, Body = unknown>(request: CoreUnaryRequest<Body>): Promise<Response>;
  serverStream<Response = unknown, Body = unknown>(request: CoreStreamRequest<Body>): AsyncIterable<Response>;
}

export interface CoreClientOptions {
  readonly transport: CoreTransport;
  readonly authMetadata?: () => CoreMetadataInput | Promise<CoreMetadataInput>;
}

export type CoreMetadataInput = Readonly<Record<string, string>>;

export class CoreClient {
  readonly #transport: CoreTransport;
  readonly #authMetadata?: () => CoreMetadataInput | Promise<CoreMetadataInput>;

  constructor(options: CoreClientOptions) {
    this.#transport = options.transport;
    this.#authMetadata = options.authMetadata;
  }

  async unary<Response = unknown, Body = unknown>(request: CoreUnaryRequest<Body>): Promise<Response> {
    return this.#transport.unary<Response, Body>({
      ...request,
      metadata: await this.#metadata(request.metadata),
    });
  }

  async *serverStream<Response = unknown, Body = unknown>(request: CoreStreamRequest<Body>): AsyncIterable<Response> {
    yield* this.#transport.serverStream<Response, Body>({
      ...request,
      metadata: await this.#metadata(request.metadata),
    });
  }

  unsafeRaw(): CoreTransport {
    return this.#transport;
  }

  async #metadata(metadata: CoreMetadataInput | undefined): Promise<CoreMetadataInput> {
    return {
      ...(this.#authMetadata ? await this.#authMetadata() : {}),
      ...(metadata ?? {}),
    };
  }
}

