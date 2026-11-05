// Original line icons for Zakka (drawn for this project).
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const SearchIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </svg>
);

export const BagIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z" />
    <path d="M9 10V7a3 3 0 0 1 6 0v3" />
  </svg>
);

export const UserIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20c1.2-3.4 3.8-5 7-5s5.8 1.6 7 5" />
  </svg>
);

export const GlobeIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.4 2.6 3.5 5.4 3.5 8.5s-1.1 5.9-3.5 8.5c-2.4-2.6-3.5-5.4-3.5-8.5s1.1-5.9 3.5-8.5z" />
  </svg>
);

export const ChatIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 18.5 5.3 15A7.5 7.5 0 1 1 9 18.6z" />
    <path d="M9 10.5h6M9 13.5h3.5" />
  </svg>
);

export const TruckIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 6.5h10.5v9H3zM13.5 9.5h4l3 3v3h-7" />
    <circle cx="7" cy="17.5" r="1.7" />
    <circle cx="17" cy="17.5" r="1.7" />
  </svg>
);

export const ExternalIcon = (p: P) => (
  <svg {...base} width={16} height={16} {...p}>
    <path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
  </svg>
);

export const StarIcon = (p: P) => (
  <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden {...p}>
    <path fill="currentColor" d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z" />
  </svg>
);

export const CheckIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

/** Zakka wordmark: lowercase name with a coral "basket" dot. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-extrabold tracking-tight text-teal ${className ?? ''}`}>
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <rect x="3" y="9" width="26" height="19" rx="7" fill="#0F766E" />
        <path d="M10 11V9a6 6 0 0 1 12 0v2" stroke="#0F766E" strokeWidth="3" fill="none" strokeLinecap="round" />
        <circle cx="16" cy="18.5" r="4" fill="#F97362" />
      </svg>
      <span className="text-[1.45rem] leading-none" dir="ltr">
        zakka
      </span>
    </span>
  );
}
