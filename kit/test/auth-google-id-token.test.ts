import { afterEach, describe, expect, it } from 'vitest';

import { requestGoogleIdToken } from '@nimiplatform/kit/auth';

type GoogleWindow = Window & {
  google?: {
    accounts?: {
      id?: {
        initialize?: (config: {
          client_id: string;
          callback: (response: { credential?: string }) => void;
        }) => void;
        prompt?: (listener?: (notification: {
          isNotDisplayed?: () => boolean;
        }) => void) => void;
      };
    };
  };
};

afterEach(() => {
  delete (window as GoogleWindow).google;
});

describe('Google Identity Services credential flow', () => {
  it('returns the ID token credential instead of an OAuth access token', async () => {
    let credentialCallback: ((response: { credential?: string }) => void) | undefined;
    let initializedClientId = '';
    (window as GoogleWindow).google = {
      accounts: {
        id: {
          initialize: (config) => {
            initializedClientId = config.client_id;
            credentialCallback = config.callback;
          },
          prompt: () => undefined,
        },
      },
    };

    const tokenPromise = requestGoogleIdToken('google-client-id');
    await Promise.resolve();
    credentialCallback?.({ credential: 'google-id-token' });

    await expect(tokenPromise).resolves.toBe('google-id-token');
    expect(initializedClientId).toBe('google-client-id');
  });

  it('fails when Google reports that its credential prompt cannot be displayed', async () => {
    (window as GoogleWindow).google = {
      accounts: {
        id: {
          initialize: () => undefined,
          prompt: (listener) => listener?.({ isNotDisplayed: () => true }),
        },
      },
    };

    await expect(requestGoogleIdToken('google-client-id')).rejects.toThrow();
  });
});
