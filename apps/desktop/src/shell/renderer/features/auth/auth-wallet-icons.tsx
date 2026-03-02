// Wallet Icons
export function MetaMaskIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="8" fill="#FFF5E6"/>
      <path d="M20.05 8l-7.3 2.5-.05 14.6 7.35 4.9 7.35-4.9-.05-14.6L20.05 8z" fill="#E2761B"/>
      <path d="M20.05 8v5.5l3.05 1.5 4.25-2.5-7.3-4.5z" fill="#E4761B"/>
      <path d="M12.7 10.5l4.3 2.5 3.05-1.5V8l-7.35 2.5z" fill="#F5841F"/>
      <path d="M20.05 13.5l-3.05 1.5h6.1l-3.05-1.5z" fill="#2F3134"/>
      <path d="M20.05 13.5l-3.05 1.5-1.25 6 4.3 3.5 4.3-3.5-1.25-6-3.05-1.5z" fill="#E2761B"/>
      <path d="M12.7 10.5l-1.2 6 2.5 6.5 1.25-6-2.55-6.5z" fill="#E4761B"/>
      <path d="M27.4 10.5l-2.55 6 1.25 6 2.5-6-1.2-6z" fill="#E4761B"/>
      <path d="M16.95 30l3.1 2 3.1-2v-2.5l-3.1 2-3.1-2V30z" fill="#2F3134"/>
    </svg>
  );
}

export function BinanceIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="8" fill="#FEF9E6"/>
      <circle cx="20" cy="20" r="12" fill="#F0B90B"/>
      <path d="M20 11.5l2.5 2.5-1 1-1.5-1.5-1.5 1.5-1-1 2.5-2.5z" fill="#1A1A1A"/>
      <path d="M16 15.5l1-1 1.5 1.5-1 1-1.5-1.5z" fill="#1A1A1A"/>
      <path d="M24 15.5l-1-1-1.5 1.5 1 1 1.5-1.5z" fill="#1A1A1A"/>
      <path d="M20 28.5l-2.5-2.5 1-1 1.5 1.5 1.5-1.5 1 1-2.5 2.5z" fill="#1A1A1A"/>
      <path d="M24 24.5l-1 1-1.5-1.5 1-1 1.5 1.5z" fill="#1A1A1A"/>
      <path d="M16 24.5l1 1 1.5-1.5-1-1-1.5 1.5z" fill="#1A1A1A"/>
      <path d="M20 18l-1.5 1.5-1-1 2.5-2.5 2.5 2.5-1 1L20 18z" fill="#1A1A1A"/>
    </svg>
  );
}

export function OKXIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="8" fill="#F2F2F2"/>
      <path d="M12 12h7v7h-7V12z" fill="#121212"/>
      <path d="M21 12h7v7h-7V12z" fill="#121212"/>
      <path d="M12 21h7v7h-7v-7z" fill="#121212"/>
      <path d="M21 21h7v7h-7v-7z" fill="#121212"/>
    </svg>
  );
}
