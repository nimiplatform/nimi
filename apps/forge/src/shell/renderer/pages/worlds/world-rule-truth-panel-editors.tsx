import { useState } from 'react';
import { Button } from '@nimiplatform/nimi-kit/ui';
import { LabeledTextField, LabeledTextareaField, LabeledSelectField } from '@renderer/components/form-fields.js';
import {
  WORLD_RULE_SCOPE_OPTIONS,
  AGENT_RULE_SCOPE_OPTIONS,
  RULE_CATEGORY_OPTIONS,
  RULE_HARDNESS_OPTIONS,
  type AgentRuleFormState,
  type WorldRuleFormState,
} from './world-rule-truth-panel-shared.js';

type WorldRuleEditorProps = {
  initialForm: WorldRuleFormState;
  working: boolean;
  onSubmit: (value: WorldRuleFormState) => Promise<void>;
  onCancel: () => void;
};

function WorldRuleEditor(props: WorldRuleEditorProps) {
  const [form, setForm] = useState(props.initialForm);

  return (
    <div className="mt-3 rounded-lg border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_60%,transparent)] p-3">
      <div className="grid gap-3 md:grid-cols-2">
        <LabeledTextField
          label="Title"
          value={form.title}
          onChange={(value) => setForm((state) => ({ ...state, title: value }))}
        />
        <LabeledSelectField
          label="Scope"
          value={form.scope}
          options={WORLD_RULE_SCOPE_OPTIONS}
          onChange={(value) => setForm((state) => ({ ...state, scope: value as WorldRuleFormState['scope'] }))}
        />
      </div>
      <LabeledTextareaField
        label="Statement"
        value={form.statement}
        onChange={(value) => setForm((state) => ({ ...state, statement: value }))}
        rows={3}
        className="mt-3"
      />
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <LabeledSelectField
          label="Category"
          value={form.category}
          options={RULE_CATEGORY_OPTIONS}
          onChange={(value) => setForm((state) => ({ ...state, category: value as WorldRuleFormState['category'] }))}
        />
        <LabeledSelectField
          label="Hardness"
          value={form.hardness}
          options={RULE_HARDNESS_OPTIONS}
          onChange={(value) => setForm((state) => ({ ...state, hardness: value as WorldRuleFormState['hardness'] }))}
        />
        <LabeledTextField
          label="Priority"
          value={form.priority}
          onChange={(value) => setForm((state) => ({ ...state, priority: value }))}
        />
      </div>
      <LabeledTextareaField
        label="Reasoning"
        value={form.reasoning}
        onChange={(value) => setForm((state) => ({ ...state, reasoning: value }))}
        rows={2}
        className="mt-3"
      />
      <LabeledTextareaField
        label="Structured JSON"
        value={form.structuredText}
        onChange={(value) => setForm((state) => ({ ...state, structuredText: value }))}
        rows={4}
        className="mt-3"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          tone="primary"
          size="sm"
          disabled={props.working}
          onClick={async () => await props.onSubmit(form)}
        >
          Save Rule
        </Button>
        <Button
          tone="secondary"
          size="sm"
          disabled={props.working}
          onClick={props.onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

type AgentRuleEditorProps = {
  initialForm: AgentRuleFormState;
  working: boolean;
  onSubmit: (value: AgentRuleFormState) => Promise<void>;
  onCancel: () => void;
};

function AgentRuleEditor(props: AgentRuleEditorProps) {
  const [form, setForm] = useState(props.initialForm);

  return (
    <div className="mt-3 rounded-lg border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-panel)_60%,transparent)] p-3">
      <div className="grid gap-3 md:grid-cols-2">
        <LabeledTextField
          label="Title"
          value={form.title}
          onChange={(value) => setForm((state) => ({ ...state, title: value }))}
        />
        <LabeledSelectField
          label="Scope"
          value={form.scope}
          options={AGENT_RULE_SCOPE_OPTIONS}
          onChange={(value) => setForm((state) => ({ ...state, scope: value as AgentRuleFormState['scope'] }))}
        />
      </div>
      <LabeledTextareaField
        label="Statement"
        value={form.statement}
        onChange={(value) => setForm((state) => ({ ...state, statement: value }))}
        rows={3}
        className="mt-3"
      />
      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <LabeledSelectField
          label="Category"
          value={form.category}
          options={RULE_CATEGORY_OPTIONS}
          onChange={(value) => setForm((state) => ({ ...state, category: value as AgentRuleFormState['category'] }))}
        />
        <LabeledSelectField
          label="Hardness"
          value={form.hardness}
          options={RULE_HARDNESS_OPTIONS}
          onChange={(value) => setForm((state) => ({ ...state, hardness: value as AgentRuleFormState['hardness'] }))}
        />
        <LabeledTextField
          label="Priority"
          value={form.priority}
          onChange={(value) => setForm((state) => ({ ...state, priority: value }))}
        />
        <LabeledTextField
          label="Importance"
          value={form.importance}
          onChange={(value) => setForm((state) => ({ ...state, importance: value }))}
        />
      </div>
      <LabeledTextareaField
        label="Reasoning"
        value={form.reasoning}
        onChange={(value) => setForm((state) => ({ ...state, reasoning: value }))}
        rows={2}
        className="mt-3"
      />
      <LabeledTextareaField
        label="Structured JSON"
        value={form.structuredText}
        onChange={(value) => setForm((state) => ({ ...state, structuredText: value }))}
        rows={4}
        className="mt-3"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          tone="primary"
          size="sm"
          disabled={props.working}
          onClick={async () => await props.onSubmit(form)}
        >
          Save Rule
        </Button>
        <Button
          tone="secondary"
          size="sm"
          disabled={props.working}
          onClick={props.onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

export { AgentRuleEditor, WorldRuleEditor };
