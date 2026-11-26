import {
  AnimatePresence,
  motion,
  nimiReducedFade,
  nimiSpring,
  useNimiReducedMotion,
} from '@nimiplatform/kit/ui';
import { useUi } from './UiContext';

/** Wake screen — the Aurora-style entry. The field stays visible behind it. */
export function WakeScreen() {
  const { awake, enter } = useUi();
  const reducedMotion = useNimiReducedMotion();
  return (
    <AnimatePresence>
      {!awake ? (
        <motion.button
          key="wake-screen"
          type="button"
          className="wake nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] border-[var(--nimi-material-glass-regular-border)] backdrop-blur-[var(--nimi-backdrop-blur-regular)] backdrop-saturate-[var(--nimi-backdrop-saturate)]"
          data-nimi-material="glass-regular"
          data-nimi-tone="overlay"
          initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.985 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: reducedMotion ? 1 : 1.015 }}
          transition={reducedMotion ? nimiReducedFade() : nimiSpring('default')}
          onClick={enter}
          aria-label="进入"
        >
          <span className="wake-orb" />
          <span className="wake-word">N i m i &nbsp; O S</span>
          <span className="wake-line" />
          <span className="wake-hint">The field is yours · 点击任意处进入</span>
          <span className="wake-sim">模拟演示 · 所有身份、数据与交互均为模拟</span>
        </motion.button>
      ) : null}
    </AnimatePresence>
  );
}
