// The HErPlan mark: one node branching into two, like a story choice (docs/brand/logo-mark.svg).
// Accent parts follow the current accent, so the logo matches the theme the user picked.
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" className="logo-mark">
      <path
        d="M22 32 C34 32 32 17 44 17 M22 32 C34 32 32 47 44 47"
        fill="none"
        stroke="#5b6474"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <rect x="4" y="22" width="20" height="20" rx="6" fill="var(--accent)" />
      <rect x="42" y="8" width="18" height="18" rx="5" fill="var(--accent)" opacity="0.85" />
      <rect x="42" y="38" width="18" height="18" rx="5" fill="var(--text)" opacity="0.9" />
    </svg>
  );
}

/** Mark and wordmark "HEr" + accent "Plan". The product name is not translated. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <span className="logo" style={{ fontSize: size * 0.62 }}>
      <LogoMark size={size} />
      <span className="logo-word">
        {'HEr'}
        <b>{'Plan'}</b>
      </span>
    </span>
  );
}
