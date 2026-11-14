import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export type DemoWindowClose = { label: string; onClose: () => void };

/** Shared window chrome; closable windows expose both the window dot and an explicit accessible close control. */
export function DemoWindowHeader({ title, navigation, children, close, iconSrc }: {
  title: string;
  navigation?: ReactNode;
  children?: ReactNode;
  close?: DemoWindowClose;
  iconSrc?: string;
}) {
  return <header className="hero-demo-titlebar demo-home-titlebar">
    <div className="demo-traffic-lights">
      {close ? <button type="button" className="demo-window-close" aria-label={close.label} title={close.label} onClick={close.onClose} /> : <i aria-hidden="true" />}
      <i aria-hidden="true" />
      <i aria-hidden="true" />
    </div>
    {navigation}
    {iconSrc && <img className="demo-embedded-app-icon" src={iconSrc} alt="" />}
    <span className="demo-window-title">{title}</span>
    {children}
    {close ? (
      <button
        type="button"
        className="demo-window-explicit-close"
        aria-label={close.label}
        onClick={close.onClose}
      >
        <X size={15} aria-hidden="true" />
        <span>{close.label}</span>
      </button>
    ) : null}
  </header>;
}
