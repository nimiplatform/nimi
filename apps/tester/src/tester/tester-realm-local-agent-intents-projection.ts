import {
  ackNimiRealmLocalAgentProvisionIntent,
  ackNimiRealmLocalAgentTerminationIntent,
  listNimiRealmLocalAgentProvisionIntents,
  listNimiRealmLocalAgentTerminationIntents,
} from '@nimiplatform/sdk/realm';

export type TesterRealmLocalAgentIntentsProjection = {
  provisionCount: number;
  terminationCount: number;
  ackedProvisionOutcome: string;
  ackedTerminationOutcome: string;
};

export async function loadTesterRealmLocalAgentIntentsProjection(): Promise<TesterRealmLocalAgentIntentsProjection> {
  let ackedProvisionOutcome = 'none';
  let ackedTerminationOutcome = 'none';
  const callRealm = async <T>(task: (realm: {
    services: {
      MeService: {
        listMyLocalAgentProvisionIntents: () => Promise<unknown>;
        ackMyLocalAgentProvisionIntent: (intentId: string, body: { outcome: string }) => Promise<unknown>;
        listMyLocalAgentTerminationIntents: () => Promise<unknown>;
        ackMyLocalAgentTerminationIntent: (intentId: string, body: { outcome: string }) => Promise<unknown>;
      };
    };
  }) => Promise<T>) =>
    task({
      services: {
        MeService: {
          listMyLocalAgentProvisionIntents: async () => ({ items: [{ id: 'tester-provision-intent' }] }),
          ackMyLocalAgentProvisionIntent: async (_intentId, body) => {
            ackedProvisionOutcome = body.outcome;
            return { ok: true };
          },
          listMyLocalAgentTerminationIntents: async () => ({ items: [{ id: 'tester-termination-intent' }] }),
          ackMyLocalAgentTerminationIntent: async (_intentId, body) => {
            ackedTerminationOutcome = body.outcome;
            return { ok: true };
          },
        },
      },
    });

  const provision = await listNimiRealmLocalAgentProvisionIntents(callRealm as never);
  const termination = await listNimiRealmLocalAgentTerminationIntents(callRealm as never);
  await ackNimiRealmLocalAgentProvisionIntent(callRealm as never, 'tester-provision-intent', { outcome: 'established' } as never);
  await ackNimiRealmLocalAgentTerminationIntent(callRealm as never, 'tester-termination-intent', { outcome: 'terminated' } as never);

  return {
    provisionCount: provision.length,
    terminationCount: termination.length,
    ackedProvisionOutcome,
    ackedTerminationOutcome,
  };
}
