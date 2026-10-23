// @nimi-authority: definition.nimi.nimiday.assistant.business
export type FollowUpDraft = {
  step: number;
  content: {
    title: string;
    when: string;
    goal: string;
    notice: string;
    recipients: string;
    targetRef: string;
    agentBinding: string;
    publishHome: boolean;
  };
  sourceRef: string;
  sourceReference: string;
};
