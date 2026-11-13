import type { IncomingMessage, ServerResponse } from 'node:http';
import type { UserConfig } from 'vite';

export interface NimiWebClientConfig {
  readonly appId: string;
  readonly clientId: string;
  readonly realmEnvironmentId: string;
  readonly officialWebBaseUrl: string;
  readonly realmBaseUrl: string;
  readonly redirectUri: string;
}
export function readWebDevelopment(manifest: unknown, options?: { realm?: 'official' | 'local'; env?: Record<string, string | undefined> }): Readonly<{
  site: URL; realm: URL; official: URL; command: string; script: string;
  config: Readonly<NimiWebClientConfig>;
}>;
export function isWebCoordinationPath(method: string, url: string): boolean;
export function webOriginGuard(site: URL): (request: IncomingMessage, response: ServerResponse, next: () => void) => void;
export function nimiWebViteConfig(options: {
  root: string;
  env?: Record<string, string | undefined>;
  serve?: boolean;
  release?: boolean;
}): UserConfig;
