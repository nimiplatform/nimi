import type {
  DesktopSimulatorBehaviorContext,
  DesktopSimulatorCommandEnvelope,
  DesktopSimulatorInitialInput,
  DesktopSimulatorJsonValue,
  DesktopSimulatorProjectionInput,
} from './protocol.js';

type JsonRecord = { readonly [key: string]: DesktopSimulatorJsonValue };

function record(value: DesktopSimulatorJsonValue, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`DESKTOP_SIMULATOR_${label}_INVALID`);
  }
  return value as JsonRecord;
}

function state(value: DesktopSimulatorJsonValue): JsonRecord {
  const candidate = record(value, 'STATE');
  if (candidate.protocolRevision !== 1 || typeof candidate.locale !== 'string') {
    throw new Error('DESKTOP_SIMULATOR_STATE_INVALID');
  }
  return candidate;
}

export const desktopSimulatorBehavior = Object.freeze({
  initialState(input: DesktopSimulatorInitialInput): DesktopSimulatorJsonValue {
    const moduleData = record(input.moduleData, 'MODULE_DATA');
    const locale = moduleData.locale;
    if (locale !== 'en' && locale !== 'zh') {
      throw new Error('DESKTOP_SIMULATOR_LOCALE_INVALID');
    }
    return { protocolRevision: 1, locale, appliedAt: null };
  },
  reduce(
    currentValue: DesktopSimulatorJsonValue,
    envelope: DesktopSimulatorCommandEnvelope,
    context: DesktopSimulatorBehaviorContext,
  ) {
    const current = state(currentValue);
    if (envelope.type !== 'desktop.locale.apply') {
      throw new Error(`DESKTOP_SIMULATOR_COMMAND_UNDECLARED:${envelope.type}`);
    }
    const payload = record(envelope.payload, 'LOCALE_PAYLOAD');
    if (payload.locale !== 'en' && payload.locale !== 'zh') {
      throw new Error('DESKTOP_SIMULATOR_LOCALE_INVALID');
    }
    return {
      state: { ...current, locale: payload.locale, appliedAt: context.now },
      events: [],
    };
  },
  project(
    currentValue: DesktopSimulatorJsonValue,
    instance: DesktopSimulatorProjectionInput,
  ): DesktopSimulatorJsonValue {
    return {
      ...state(currentValue),
      surfaceId: instance.surfaceId,
      route: {
        pathname: instance.route.pathname,
        search: instance.route.search.map(({ key, value }) => ({ key, value })),
        fragment: instance.route.fragment,
      },
    };
  },
});
