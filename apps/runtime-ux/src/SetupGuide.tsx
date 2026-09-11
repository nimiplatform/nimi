import { useState } from 'react';
import { Button, Pill } from './ui';
import { IconCheck, IconCloud, IconCpu, IconProfile, IconSparkle } from './icons';
import { presets, type PresetId } from './data';

const stepTitles = ['How should Nimi answer?', 'Confirm your setup', 'Pick a personality'] as const;

const presetIcons: Record<PresetId, typeof IconCloud> = {
  quality: IconCloud,
  balanced: IconSparkle,
  private: IconCpu,
};

export function SetupGuide({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [preset, setPreset] = useState<PresetId | null>(null);
  const [personality, setPersonality] = useState<string | null>(null);
  const done = step >= 3;
  const chosen = presets.find((p) => p.id === preset);

  return (
    <div className="rt-wizard-frame">
      <div className="rt-wizard-head">
        <h2>Setup Guide</h2>
        <p>{done ? 'Nimi is ready.' : `Step ${step + 1} of 3 — ${stepTitles[step]}`}</p>
        <div className="rt-steps" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className={`rt-step-seg${step > i || done ? ' done' : ''}`} />
          ))}
        </div>
      </div>

      <div className="rt-wizard-body">
        {step === 0 && (
          <>
            <p style={{ marginTop: 0, color: 'var(--nimi-text-secondary)' }}>
              This one choice sets everything up. You can change it later in <strong>Answers</strong>.
            </p>
            {presets.map((p) => {
              const Icon = presetIcons[p.id];
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`rt-choice-card${preset === p.id ? ' selected' : ''}`}
                  aria-pressed={preset === p.id}
                  onClick={() => setPreset(p.id)}
                >
                  <Icon size={18} />
                  <span>
                    <strong>
                      {p.name}
                      {p.recommended && (
                        <>
                          {' '}
                          <Pill tone="success">Recommended</Pill>
                        </>
                      )}
                    </strong>
                    {p.tagline}
                  </span>
                </button>
              );
            })}
          </>
        )}

        {step === 1 && chosen && (
          <>
            <p style={{ marginTop: 0, color: 'var(--nimi-text-secondary)' }}>
              With <strong>{chosen.name}</strong>, Nimi will:
            </p>
            <div className="rt-plan-card current">
              {chosen.confirmLines.map((line) => (
                <div className="rt-plan-route" key={line}>
                  <IconCheck size={14} /> {line}
                </div>
              ))}
            </div>
            <p style={{ color: 'var(--nimi-text-secondary)', fontSize: 12 }}>
              {preset === 'quality'
                ? 'This needs a cloud service connection — you\'ll add a key on the next screen if none exists.'
                : preset === 'private'
                  ? 'This downloads models to this device — it can take a while on first setup.'
                  : 'This downloads a small local model and uses your cloud connection only when needed.'}
            </p>
          </>
        )}

        {step === 2 && (
          <>
            {['Companion', 'Coding Assistant'].map((name) => (
              <button
                key={name}
                type="button"
                className={`rt-choice-card${personality === name ? ' selected' : ''}`}
                aria-pressed={personality === name}
                onClick={() => setPersonality(name)}
              >
                <IconProfile size={18} />
                <span>
                  <strong>{name}</strong>
                  {name === 'Companion'
                    ? 'Warm conversational tone, sensible defaults.'
                    : 'Precise answers tuned for development work.'}
                </span>
              </button>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setPersonality('New personality')}>
              Or create a new personality…
            </Button>
          </>
        )}

        {done && (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <Pill tone="success">
              <IconCheck size={12} /> Setup complete
            </Pill>
            <h3 style={{ margin: '12px 0 4px' }}>You're all set</h3>
            <p style={{ margin: 0, color: 'var(--nimi-text-secondary)' }}>
              Answers: {chosen?.name ?? 'Balanced'} · Personality: {personality ?? 'Companion'}.
              Change either any time from Home.
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
            disabled={(step === 0 && !preset) || (step === 2 && !personality)}
            onClick={() => setStep(step + 1)}
          >
            {step === 2 ? 'Finish' : 'Continue'}
          </Button>
        )}
      </div>
    </div>
  );
}
