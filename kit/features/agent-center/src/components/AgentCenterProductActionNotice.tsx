import { useState } from 'react';
import { translateAgentCenter } from '../i18n.js';
import type {
  AgentCenterActionAvailability,
  AgentCenterI18n,
  AgentCenterProductAction,
  AgentCenterSession,
} from '../types.js';
import { AgentButton, Notice } from './AgentCenterPrimitives.js';

const REASON_COPY = {
  'needs-grant': 'Permission is required for this action.',
  'request-pending': 'The permission request is waiting for a decision.',
  denied: 'Permission was denied for this action.',
  revoked: 'Permission was revoked for this action.',
  'runtime-offline': 'Permission status is unavailable while Runtime is offline.',
  'reserved-not-admitted': 'This action is not admitted yet.',
  unknown: 'Permission availability is unknown.',
} as const;

const NEXT_STEP_COPY = {
  requestPermission: 'Request permission',
  openPermissionSettings: 'Open permission settings',
  retry: 'Retry',
  wait: 'Wait for permission availability',
} as const;

export function AgentCenterProductActionNotice(props: {
  readonly action: AgentCenterProductAction;
  readonly availability: AgentCenterActionAvailability;
  readonly session: AgentCenterSession;
  readonly i18n?: AgentCenterI18n;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  if (props.availability.state === 'available') return null;
  const { nextStep, reason } = props.availability;
  const reasonLabel = translateAgentCenter(
    props.i18n,
    `AgentCenter.permission.reason.${reason}`,
    REASON_COPY[reason],
  );
  const nextStepLabel = translateAgentCenter(
    props.i18n,
    `AgentCenter.permission.nextStep.${nextStep}`,
    NEXT_STEP_COPY[nextStep],
  );
  const invokeNextStep = async () => {
    setBusy(true);
    setFailure('');
    try {
      if (nextStep === 'requestPermission') await props.session.requestPermission();
      else if (nextStep === 'openPermissionSettings') await props.session.openPermissionSettings();
      else if (nextStep === 'retry') await props.session.refresh();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Notice tone="warn">
      <div
        className="grid min-w-0 gap-2"
        data-agent-center-action={props.action}
        data-agent-center-action-reason={reason}
        data-agent-center-action-state="unavailable"
        data-agent-center-next-step={nextStep}
      >
        <span>{reasonLabel}</span>
        {nextStep === 'wait' ? <span>{nextStepLabel}</span> : (
          <AgentButton
            dataAttrs={{ 'data-agent-center-next-step-action': nextStep }}
            disabled={busy}
            onClick={() => { void invokeNextStep(); }}
            variant="accent"
          >
            {nextStepLabel}
          </AgentButton>
        )}
        {failure ? <span aria-live="polite">{failure}</span> : null}
      </div>
    </Notice>
  );
}
