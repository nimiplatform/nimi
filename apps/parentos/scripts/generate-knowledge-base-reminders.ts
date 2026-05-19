type ReminderKindLiteral = 'task' | 'guide' | 'practice' | 'consult';

export const ACTION_TYPE_TO_KIND: Record<string, ReminderKindLiteral> = {
  go_hospital: 'task',
  record_data: 'task',
  start_training: 'task',
  read_guide: 'guide',
  observe: 'practice',
  ai_consult: 'consult',
};

interface ReminderExplainSource {
  citation: string;
  url?: string;
}

interface ReminderExplainShape {
  whyNow: string;
  howTo: string[];
  doneWhen: string;
  ifNotNow?: string;
  pitfalls?: string[];
  sources: ReminderExplainSource[];
}

export interface BaseReminderRule {
  ruleId: string;
  domain: string;
  category: string;
  kind: ReminderKindLiteral;
  title: string;
  description: string;
  triggerAge: { startMonths: number; endMonths: number };
  triggerCondition?: { dataField: string; operator: string; value: unknown };
  priority: string;
  nurtureMode: { relaxed: string; balanced: string; advanced: string };
  actionType: string;
  repeatRule?: { intervalMonths: number; maxRepeats: number };
  explain?: ReminderExplainShape;
  expiryMonths?: number;
  tags?: string[];
}

export function liftOrthodonticRules(readYaml: (filename: string) => unknown): BaseReminderRule[] {
  const spec = readYaml('orthodontic-protocols.yaml') as {
    rules?: Array<{
      ruleId: string;
      domain: string;
      title: string;
      description: string;
      priority: string;
      actionType: string;
      cadence: string;
      defaultIntervalDays?: number;
      nurtureMode: { relaxed: string; balanced: string; advanced: string };
      source: string;
      applianceTypes?: string[];
    }>;
    dentalFollowUpRules?: Array<{
      ruleId: string;
      domain: string;
      title: string;
      description: string;
      intervalMonths: number;
      priority: string;
      actionType: string;
      nurtureMode: { relaxed: string; balanced: string; advanced: string };
      triggeredBy: { dentalEventType: string };
      source: string;
    }>;
  };

  const out: BaseReminderRule[] = [];
  for (const rule of spec.rules ?? []) {
    const kind = ACTION_TYPE_TO_KIND[rule.actionType];
    if (kind !== 'task') {
      throw new Error(
        `liftOrthodonticRules: rule "${rule.ruleId}" actionType '${rule.actionType}' maps to kind '${kind}', but orthodontic protocol rules are admitted only as kind='task' (PO-REMI-002)`,
      );
    }
    out.push({
      ruleId: rule.ruleId,
      domain: rule.domain,
      category: 'personalized',
      kind: 'task',
      title: rule.title,
      description: rule.description,
      triggerAge: { startMonths: 0, endMonths: 216 },
      triggerCondition: {
        dataField: 'orthodontic_appliance.status',
        operator: '=',
        value: 'active',
      },
      priority: rule.priority,
      nurtureMode: rule.nurtureMode,
      actionType: rule.actionType,
      tags: ['orthodontic-protocol', ...(rule.applianceTypes ?? []).map((t) => `appliance:${t}`)],
    });
  }

  for (const rule of spec.dentalFollowUpRules ?? []) {
    const kind = ACTION_TYPE_TO_KIND[rule.actionType];
    if (kind !== 'task') {
      throw new Error(
        `liftOrthodonticRules: dental follow-up rule "${rule.ruleId}" actionType '${rule.actionType}' maps to kind '${kind}', but dental follow-up rules are admitted only as kind='task' (PO-REMI-002)`,
      );
    }
    out.push({
      ruleId: rule.ruleId,
      domain: rule.domain,
      category: 'personalized',
      kind: 'task',
      title: rule.title,
      description: rule.description,
      triggerAge: { startMonths: 0, endMonths: 216 },
      triggerCondition: {
        dataField: 'dental_records.eventType',
        operator: '=',
        value: rule.triggeredBy.dentalEventType,
      },
      priority: rule.priority,
      nurtureMode: rule.nurtureMode,
      actionType: rule.actionType,
      repeatRule: { intervalMonths: rule.intervalMonths, maxRepeats: -1 },
      tags: ['dental-followup', `trigger:${rule.triggeredBy.dentalEventType}`],
    });
  }
  return out;
}
