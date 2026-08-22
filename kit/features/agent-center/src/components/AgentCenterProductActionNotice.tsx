import { useState } from 'react';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import { translateAgentCenter } from '../i18n.js';
import type {
  AgentCenterActionAvailability,
  AgentCenterI18n,
  AgentCenterProductAction,
  AgentCenterSession,
} from '../types.js';

const REASON_COPY = {
  'runtime-offline': 'Runtime is offline.',
  'owner-rejected': 'Runtime rejected this action.',
  'selection-required': 'A configuration selection is required.',
  unsupported: 'This action is not supported.',
  'operation-unavailable': 'This action is unavailable in the current surface.',
  unknown: 'Action availability is unknown.',
} as const;

const NEXT_STEP_COPY = {
  openRuntimeSettings: 'Open Runtime settings',
  retry: 'Retry',
} as const;

export function AgentCenterProductActionNotice(props: {
  readonly action: AgentCenterProductAction;
  readonly availability: AgentCenterActionAvailability;
  readonly session: AgentCenterSession;
  readonly i18n?: AgentCenterI18n;
  readonly onOpenRuntimeSettings?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  if (props.availability.state === 'available') return null;
  const { nextStep, reason } = props.availability;
  const reasonLabel = translateAgentCenter(
    props.i18n,
    `AgentCenter.availability.reason.${reason}`,
    REASON_COPY[reason],
  );
  const nextStepLabel = translateAgentCenter(
    props.i18n,
    `AgentCenter.availability.nextStep.${nextStep}`,
    NEXT_STEP_COPY[nextStep],
  );
  const invokeNextStep = async () => {
    setBusy(true);
    setFailure('');
    try {
      if (nextStep === 'retry') await props.session.refresh();
      else if (nextStep === 'openRuntimeSettings') props.onOpenRuntimeSettings?.();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <InlineAlert tone="warning">
      <div
        className="grid min-w-0 gap-2"
        data-agent-center-action={props.action}
        data-agent-center-action-reason={reason}
        data-agent-center-action-state="unavailable"
        data-agent-center-next-step={nextStep}
      >
        <span>{reasonLabel}</span>
        {nextStep === 'openRuntimeSettings' && !props.onOpenRuntimeSettings ? <span>{nextStepLabel}</span> : (
          <Button
            data-agent-center-next-step-action={nextStep}
            disabled={busy}
            onClick={() => { void invokeNextStep(); }}
            size="sm"
            tone="primary"
          >
            {nextStepLabel}
          </Button>
        )}
        {failure ? <span aria-live="polite">{failure}</span> : null}
      </div>
    </InlineAlert>
  );
}
