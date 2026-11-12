import { ImageResponse } from 'next/og';

// The picture shown when a Zakka link is shared. Logo and name only, so it reads the same in every language.
export const alt = 'Zakka';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 48,
          background: '#FBF8F3',
        }}
      >
        <svg width="260" height="260" viewBox="0 0 32 32">
          <rect x="3" y="9" width="26" height="19" rx="7" fill="#0F766E" />
          <path d="M10 11V9a6 6 0 0 1 12 0v2" stroke="#0F766E" strokeWidth="3" fill="none" strokeLinecap="round" />
          <circle cx="16" cy="18.5" r="4" fill="#F97362" />
        </svg>
        <div style={{ fontSize: 210, fontWeight: 800, letterSpacing: -8, color: '#0F766E' }}>zakka</div>
      </div>
    ),
    size,
  );
}
