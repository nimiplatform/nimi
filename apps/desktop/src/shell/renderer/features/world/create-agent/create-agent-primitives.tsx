/**
 * Shared visual primitives for the lightweight RealmAgent creation surface.
 *
 * Extracted so the mode panels and the review panel share one styling
 * vocabulary instead of each app-local panel re-deriving form chrome.
 */

import type React from 'react';

export function SectionTitle(input: { icon: React.ReactNode; title: string; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300 shadow-[0_0_18px_rgba(16,185,129,0.12)]">
          {input.icon}
        </div>
        <h3 className="text-sm font-semibold tracking-[0.02em] text-[#E8FFF6]">{input.title}</h3>
      </div>
      {input.extra}
    </div>
  );
}

export function FieldLabel(input: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="mb-2 block text-[11px] font-medium uppercase tracking-[0.18em] text-emerald-300/75">
      {input.children}
      {input.required ? <span className="ml-1 text-red-400">*</span> : null}
    </label>
  );
}

export function TextInput(input: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...input}
      className={`h-11 w-full rounded-2xl border border-emerald-300/16 bg-white/5 px-4 text-sm text-[#E8FFF6] outline-none transition-all placeholder:text-[#9CC8B5]/35 focus:border-emerald-300/60 focus:bg-white/[0.07] focus:shadow-[0_0_0_1px_rgba(110,231,183,0.18),0_0_18px_rgba(16,185,129,0.12)] ${input.className || ''}`.trim()}
    />
  );
}

export function TextArea(input: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...input}
      className={`w-full rounded-2xl border border-emerald-300/16 bg-white/5 px-4 py-3 text-sm text-[#E8FFF6] outline-none transition-all placeholder:text-[#9CC8B5]/35 resize-none focus:border-emerald-300/60 focus:bg-white/[0.07] focus:shadow-[0_0_0_1px_rgba(110,231,183,0.18),0_0_18px_rgba(16,185,129,0.12)] ${input.className || ''}`.trim()}
    />
  );
}

export function CardPanel(input: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-[24px] nimi-material-glass-regular border border-white/6 bg-white/[0.035] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02),0_18px_44px_rgba(0,0,0,0.32)] backdrop-blur-[var(--nimi-backdrop-blur-regular)] ${input.className || ''}`.trim()}>
      {input.children}
    </div>
  );
}
