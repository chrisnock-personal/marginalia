/**
 * The Marginalia mark: a fountain-pen nib finishing a wavy line.
 * Drawn on a 64-unit grid; `heavy` thickens the line for small sizes.
 */
export function NibMark({ size = 24, heavy = false }: { size?: number; heavy?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="nib-mark">
      <path
        d="M6 44 C 11 36, 16 36, 20 44 S 29 52, 34 44"
        fill="none"
        stroke="currentColor"
        strokeWidth={heavy ? 4.4 : 3.6}
        strokeLinecap="round"
      />
      <g transform="translate(34 44) rotate(40)">
        <path d="M0 0 C -3 -5 -8 -12 -8 -19 L -8 -27 L 8 -27 L 8 -19 C 8 -12 3 -5 0 0 Z" fill="currentColor" />
        <line x1="0" y1="-2" x2="0" y2="-13" stroke="var(--paper)" strokeWidth={heavy ? 2.4 : 2} strokeLinecap="round" />
        <rect x="-6" y="-33" width="12" height="4.5" rx="1" fill="currentColor" />
      </g>
    </svg>
  )
}

/** Mark and name, for the top bar. */
export default function Logo() {
  return (
    <span className="brand">
      <NibMark />
      <span className="brand-name">Marginalia</span>
    </span>
  )
}
