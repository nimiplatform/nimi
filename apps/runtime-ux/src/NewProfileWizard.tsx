import { useState } from 'react';
import { Button, Pill } from './ui';
import { IconCheck, IconLoadout, IconProfile, IconSparkle } from './icons';

type Path = 'template' | 'current' | 'scratch';

const stepTitles = ['Choose how to start', 'Configure', 'Name & finish'] as const;

export function NewProfileWizard({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [path, setPath] = useState<Path | null>(null);
  const [template, setTemplate] = useState<string | null>(null);
  const [name, setName] = useState('');
  const done = step >= 3;

  return (
    <div className="rt-wizard-frame">
      <div className="rt-wizard-head">
        <h2>New profile</h2>
        <p>{done ? 'Profile created.' : `Step ${step + 1} of 3 — ${stepTitles[step]}`}</p>
        <div className="rt-steps" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className={`rt-step-seg${step > i || done ? ' done' : ''}`} />
          ))}
        </div>
      </div>

      <div className="rt-wizard-body">
        {step === 0 && (
          <>
            <button
              type="button"
              className={`rt-choice-card${path === 'template' ? ' selected' : ''}`}
              aria-pressed={path === 'template'}
              onClick={() => setPath('template')}
            >
              <IconSparkle size={18} />
              <span>
                <strong>From template</strong>
                Start from a recommended profile and tweak it.
              </span>
            </button>
            <button
              type="button"
              className={`rt-choice-card${path === 'current' ? ' selected' : ''}`}
              aria-pressed={path === 'current'}
              onClick={() => setPath('current')}
            >
              <IconLoadout size={18} />
              <span>
                <strong>From current setup</strong>
                Snapshot the models, loadouts, and settings you use right now.
              </span>
            </button>
            <button
              type="button"
              className={`rt-choice-card${path === 'scratch' ? ' selected' : ''}`}
              aria-pressed={path === 'scratch'}
              onClick={() => setPath('scratch')}
            >
              <IconProfile size={18} />
              <span>
                <strong>Author manually</strong>
                Build every setting from scratch.
              </span>
            </button>
          </>
        )}

        {step === 1 && path === 'template' && (
          <>
            {['Companion', 'Coding Assistant', 'Image Studio'].map((t) => (
              <button
                key={t}
                type="button"
                className={`rt-choice-card${template === t ? ' selected' : ''}`}
                aria-pressed={template === t}
                onClick={() => setTemplate(t)}
              >
                <IconSparkle size={18} />
                <span><strong>{t}</strong>Recommended template</span>
              </button>
            ))}
          </>
        )}

        {step === 1 && path === 'current' && (
          <div className="rt-plan-card current">
            <div className="rt-plan-route"><IconCheck size={14} /> Loadouts: current plans for Chat, Image, Embedding</div>
            <div className="rt-plan-route"><IconCheck size={14} /> Connectors: OpenAI, Anthropic</div>
            <div className="rt-plan-route"><IconCheck size={14} /> Memory &amp; tone settings from "Companion"</div>
          </div>
        )}

        {step === 1 && path === 'scratch' && (
          <p style={{ marginTop: 0, color: 'var(--nimi-text-secondary)' }}>
            A blank profile starts with recommended loadouts and default memory settings. You can
            edit everything after it's created.
          </p>
        )}

        {step === 2 && (
          <label style={{ display: 'block' }}>
            <span style={{ display: 'block', marginBottom: 6, fontWeight: 600 }}>Profile name</span>
            <input
              className="rt-input"
              placeholder={template ? `${template} (custom)` : 'My profile'}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}

        {done && (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <Pill tone="success">
              <IconCheck size={12} /> Profile created
            </Pill>
            <h3 style={{ margin: '12px 0 4px' }}>{name || template || 'My profile'}</h3>
            <p style={{ margin: 0, color: 'var(--nimi-text-secondary)' }}>
              Created {path === 'template' ? `from the ${template} template` : path === 'current' ? 'from your current setup' : 'from scratch'}.
              Set it active from the Personality page.
            </p>
          </div>
        )}
      </div>

      <div className="rt-wizard-foot">
        <Button onClick={() => (step === 0 || done ? onClose() : setStep(step - 1))}>
          {step === 0 ? 'Cancel' : done ? 'Close' : 'Back'}
        </Button>
        {!done && (
          <Button
            variant="primary"
            disabled={(step === 0 && !path) || (step === 1 && path === 'template' && !template)}
            onClick={() => setStep(step + 1)}
          >
            {step === 2 ? 'Create profile' : 'Continue'}
          </Button>
        )}
      </div>
    </div>
  );
}
