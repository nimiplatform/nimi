import { useRef, useState, useLayoutEffect } from 'react';
import type { ProfileTab } from '../profile-model';
import { PROFILE_TABS } from '../profile-model';

type ProfileTabBarProps = {
  activeTab: ProfileTab;
  onTabChange: (tab: ProfileTab) => void;
};

export function ProfileTabBar({ activeTab, onTabChange }: ProfileTabBarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const idx = PROFILE_TABS.indexOf(activeTab);
    const button = container.children[idx] as HTMLElement | undefined;
    if (!button) return;
    setIndicator({ left: button.offsetLeft, width: button.offsetWidth });
  }, [activeTab]);

  return (
    <div className="relative border-b border-gray-100 bg-white">
      <div ref={containerRef} className="flex">
        {PROFILE_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onTabChange(tab)}
            className={`relative flex-1 py-3.5 text-center text-sm font-medium transition-colors ${
              activeTab === tab ? 'text-mint-600' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
      <span
        className="absolute bottom-0 h-0.5 bg-mint-500 transition-all duration-300 ease-out"
        style={{ left: indicator.left, width: indicator.width }}
      />
    </div>
  );
}
