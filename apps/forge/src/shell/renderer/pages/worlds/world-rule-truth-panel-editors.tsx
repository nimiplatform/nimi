import { useState } from 'react';
import {
  AGENT_RULE_SCOPES,
  RULE_CATEGORIES,
  RULE_HARDNESS,
  WORLD_RULE_SCOPES,
  TruthField,
  TruthInput,
  TruthSelect,
  TruthTextarea,
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
    <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
      <div className="grid gap-3 md:grid-cols-2">
        <TruthField label="Title">
          <TruthInput value={form.title} onChange={(event) => setForm((state) => ({ ...state, title: event.target.value }))} />
        </TruthField>
        <TruthField label="Scope">
          <TruthSelect value={form.scope} onChange={(event) => setForm((state) => ({ ...state, scope: event.target.value as WorldRuleFormState['scope'] }))}>
            {WORLD_RULE_SCOPES.map((item) => <option key={item} value={item}>{item}</option>)}
          </TruthSelect>
        </TruthField>
      </div>
      <div className="mt-3">
        <TruthField label="Statement">
          <TruthTextarea rows={3} value={form.statement} onChange={(event) => setForm((state) => ({ ...state, statement: event.target.value }))} />
        </TruthField>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <TruthField label="Category">
          <TruthSelect value={form.category} onChange={(event) => setForm((state) => ({ ...state, category: event.target.value as WorldRuleFormState['category'] }))}>
            {RULE_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
          </TruthSelect>
        </TruthField>
        <TruthField label="Hardness">
          <TruthSelect value={form.hardness} onChange={(event) => setForm((state) => ({ ...state, hardness: event.target.value as WorldRuleFormState['hardness'] }))}>
            {RULE_HARDNESS.map((item) => <option key={item} value={item}>{item}</option>)}
          </TruthSelect>
        </TruthField>
        <TruthField label="Priority">
          <TruthInput value={form.priority} onChange={(event) => setForm((state) => ({ ...state, priority: event.target.value }))} />
        </TruthField>
      </div>
      <div className="mt-3">
        <TruthField label="Reasoning">
          <TruthTextarea rows={2} value={form.reasoning} onChange={(event) => setForm((state) => ({ ...state, reasoning: event.target.value }))} />
        </TruthField>
      </div>
      <div className="mt-3">
        <TruthField label="Structured JSON">
          <TruthTextarea rows={4} value={form.structuredText} onChange={(event) => setForm((state) => ({ ...state, structuredText: event.target.value }))} />
        </TruthField>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={props.working}
          onClick={async () => await props.onSubmit(form)}
          className="rounded-md bg-white px-3 py-2 text-sm font-medium text-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
        >
          Save Rule
        </button>
        <button
          type="button"
          disabled={props.working}
          onClick={props.onCancel}
          className="rounded-md border border-neutral-700 px-3 py-2 text-sm text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white disabled:opacity-50"
        >
          Cancel
        </button>
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
    <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
      <div className="grid gap-3 md:grid-cols-2">
        <TruthField label="Title">
          <TruthInput value={form.title} onChange={(event) => setForm((state) => ({ ...state, title: event.target.value }))} />
        </TruthField>
        <TruthField label="Scope">
          <TruthSelect value={form.scope} onChange={(event) => setForm((state) => ({ ...state, scope: event.target.value as AgentRuleFormState['scope'] }))}>
            {AGENT_RULE_SCOPES.map((item) => <option key={item} value={item}>{item}</option>)}
          </TruthSelect>
        </TruthField>
      </div>
      <div className="mt-3">
        <TruthField label="Statement">
          <TruthTextarea rows={3} value={form.statement} onChange={(event) => setForm((state) => ({ ...state, statement: event.target.value }))} />
        </TruthField>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <TruthField label="Category">
          <TruthSelect value={form.category} onChange={(event) => setForm((state) => ({ ...state, category: event.target.value as AgentRuleFormState['category'] }))}>
            {RULE_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
          </TruthSelect>
        </TruthField>
        <TruthField label="Hardness">
          <TruthSelect value={form.hardness} onChange={(event) => setForm((state) => ({ ...state, hardness: event.target.value as AgentRuleFormState['hardness'] }))}>
            {RULE_HARDNESS.map((item) => <option key={item} value={item}>{item}</option>)}
          </TruthSelect>
        </TruthField>
        <TruthField label="Priority">
          <TruthInput value={form.priority} onChange={(event) => setForm((state) => ({ ...state, priority: event.target.value }))} />
        </TruthField>
        <TruthField label="Importance">
          <TruthInput value={form.importance} onChange={(event) => setForm((state) => ({ ...state, importance: event.target.value }))} />
        </TruthField>
      </div>
      <div className="mt-3">
        <TruthField label="Reasoning">
          <TruthTextarea rows={2} value={form.reasoning} onChange={(event) => setForm((state) => ({ ...state, reasoning: event.target.value }))} />
        </TruthField>
      </div>
      <div className="mt-3">
        <TruthField label="Structured JSON">
          <TruthTextarea rows={4} value={form.structuredText} onChange={(event) => setForm((state) => ({ ...state, structuredText: event.target.value }))} />
        </TruthField>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={props.working}
          onClick={async () => await props.onSubmit(form)}
          className="rounded-md bg-white px-3 py-2 text-sm font-medium text-black transition-colors hover:bg-neutral-200 disabled:opacity-50"
        >
          Save Rule
        </button>
        <button
          type="button"
          disabled={props.working}
          onClick={props.onCancel}
          className="rounded-md border border-neutral-700 px-3 py-2 text-sm text-neutral-300 transition-colors hover:border-neutral-500 hover:text-white disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export { AgentRuleEditor, WorldRuleEditor };
