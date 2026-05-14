import { Surface } from '@nimiplatform/nimi-kit/ui';
import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { type PediatricDrug, PEDIATRIC_DRUGS, matchDrugs } from './pediatric-drugs.js';

export interface DrugSelection {
  name: string;
  unit: string;
  frequency: string;
  tags: string[];
  /** Whether this came from the preset dictionary */
  fromDict: boolean;
}

interface DrugComboBoxProps {
  value: string;
  onChange: (val: string) => void;
  onSelect: (drug: DrugSelection) => void;
  /** Extra drugs from history (personalized) */
  historyDrugs?: Array<{ name: string; unit?: string; frequency?: string }>;
  placeholder?: string;
}

export function DrugComboBox({ value, onChange, onSelect, historyDrugs, placeholder }: DrugComboBoxProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Build full drug list: history first, then preset
  const allDrugs: PediatricDrug[] = (() => {
    const histEntries: PediatricDrug[] = (historyDrugs ?? []).map((h, i) => ({
      id: `hist-${i}`,
      name: h.name,
      unit: h.unit ?? '次',
      frequency: h.frequency ?? '',
      py: '',
      tags: [],
    }));
    // Deduplicate: remove history items that match preset names
    const presetNames = new Set(PEDIATRIC_DRUGS.map((d) => d.name));
    const uniqueHist = histEntries.filter((h) => !presetNames.has(h.name));
    return [...uniqueHist, ...PEDIATRIC_DRUGS];
  })();

  const queryLen = value.trim().length;
  const shouldSearch = queryLen >= 2;
  const matches = shouldSearch ? matchDrugs(value, allDrugs) : [];
  const showCustom = shouldSearch && !matches.some((m) => m.name === value.trim());

  const openPanel = useCallback(() => {
    setMounted(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
  }, []);

  const closePanel = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!mounted || open) return;
    const t = setTimeout(() => setMounted(false), 220);
    return () => clearTimeout(t);
  }, [mounted, open]);

  useEffect(() => {
    if (!mounted) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node) &&
          panelRef.current && !panelRef.current.contains(e.target as Node)) {
        closePanel();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [mounted, closePanel]);

  const handleSelect = (drug: PediatricDrug) => {
    onChange(drug.generic ? `${drug.name} (${drug.generic})` : drug.name);
    onSelect({
      name: drug.generic ? `${drug.name} (${drug.generic})` : drug.name,
      unit: drug.unit,
      frequency: drug.frequency,
      tags: drug.tags ?? [],
      fromDict: !drug.id.startsWith('hist-'),
    });
    closePanel();
  };

  const handleCustom = () => {
    const name = value.trim();
    onSelect({ name, unit: '次', frequency: '', tags: [], fromDict: false });
    closePanel();
  };

  // Position
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  useEffect(() => {
    if (!mounted || !wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    setPos({ left: r.left, top: r.bottom + 2, width: r.width });
  }, [mounted]);

  return (
    <div ref={wrapRef} className="relative flex-1 min-w-0">
      <input ref={inputRef}
        value={value}
        onChange={(e) => { onChange(e.target.value); if (e.target.value.trim().length >= 2) { if (!mounted) openPanel(); } else { closePanel(); } }}
        onFocus={() => { if (queryLen >= 2 && !mounted) openPanel(); }}
        placeholder={placeholder ?? '搜索药品名称或拼音首字母'}
        className="w-full bg-transparent text-[14px] text-[var(--nimi-text-primary)] outline-none"
      />

      {mounted && pos && createPortal(
        <div ref={panelRef} className="fixed z-[60]"
          style={{
            left: Math.min(pos.left, window.innerWidth - pos.width - 8),
            top: Math.min(pos.top, window.innerHeight - 260),
            width: Math.max(pos.width, 280),
            maxHeight: 240,
            opacity: open ? 1 : 0,
            transform: open ? 'translateY(0) scale(1)' : 'translateY(-4px) scale(0.98)',
            transformOrigin: 'top left',
            transition: 'opacity 0.15s ease, transform 0.15s ease',
            pointerEvents: open ? 'auto' : 'none',
          }}>
          <Surface tone="overlay" material="glass-regular" elevation="floating" padding="none" className="overflow-hidden rounded-xl">
          <div className="max-h-[240px] overflow-y-auto">
            {matches.length === 0 && !showCustom && shouldSearch && (
              <div className="px-3 py-4 text-center">
                <p className="text-[13px] text-[var(--nimi-text-muted)]">未找到匹配药品</p>
              </div>
            )}

            {matches.slice(0, 15).map((drug) => (
              <button key={drug.id}
                onClick={() => handleSelect(drug)}
                className="flex items-center gap-2 w-full px-3 py-2 text-left transition-colors hover:bg-[var(--nimi-action-ghost-hover)]">
                <div className="flex-1 min-w-0">
                  <span className="text-[14px] font-medium text-[var(--nimi-text-primary)]">{drug.name}</span>
                  {drug.generic && (
                    <span className="text-[12px] ml-1 text-[var(--nimi-text-muted)]">({drug.generic})</span>
                  )}
                </div>
                <span className="shrink-0 rounded bg-[var(--nimi-surface-active)] px-1.5 py-0.5 text-[12px] text-[var(--nimi-text-muted)]">
                  {drug.unit}
                </span>
              </button>
            ))}

            {/* Custom entry fallback */}
            {showCustom && (
              <button onClick={handleCustom}
                className="flex items-center gap-2 w-full border-t border-[var(--nimi-border-subtle)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--nimi-action-ghost-hover)]">
                <span className="text-[14px] font-medium text-[var(--nimi-action-primary-bg)]">
                  + 添加自定义药品: "{value.trim()}"
                </span>
              </button>
            )}
          </div>
          </Surface>
        </div>,
        document.body,
      )}
    </div>
  );
}
