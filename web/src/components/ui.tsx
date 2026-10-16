import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';

type IconName = 'book' | 'pen' | 'video' | 'globe' | 'image' | 'check' | 'plus' | 'upload' | 'home' | 'map' | 'search' | 'chev' | 'x' | 'doc' | 'bulb' | 'list' | 'left' | 'right' | 'camera' | 'trash' | 'refresh' | 'eye' | 'panel' | 'flag' | 'link' | 'grad';
const P: Record<IconName, React.ReactNode> = {
  book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" /><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20" transform="translate(0 -2)" /></>,
  pen: <><path d="M14.5 4.5l5 5L8 21H3v-5z" /><path d="M12.5 6.5l5 5" /></>,
  video: <><rect x="3" y="5" width="13" height="14" rx="2.5" /><path d="M16 10l5-3v10l-5-3" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10" r="1.8" /><path d="M21 16l-5-5-9 9" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>,
  home: <><path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" /></>,
  map: <><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="8" r="2.5" /><circle cx="9" cy="18" r="2.5" /><path d="M8.2 7.2l7.5.6M7 8.3l1.4 7.3M16.4 10l-5.6 6.4" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>,
  chev: <path d="M9 6l6 6-6 6" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  doc: <><path d="M6 3h8l5 5v13H6z" /><path d="M14 3v5h5M9 13h7M9 17h5" /></>,
  bulb: <><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" /></>,
  list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  left: <path d="M15 6l-6 6 6 6" />,
  right: <path d="M9 6l6 6-6 6" />,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" />,
  refresh: <><path d="M20 11a8 8 0 0 0-14.7-3.5M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.7 3.5M20 20v-4h-4" /></>,
  eye: <><path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" /><circle cx="12" cy="12" r="2.8" /></>,
  panel: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M15 4v16" /></>,
  flag: <path d="M5 21V4h11l-2 4 2 4H5" />,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  grad: <><path d="M2 9l10-5 10 5-10 5z" /><path d="M6 11v5c3 2.5 9 2.5 12 0v-5M22 9v6" /></>,
};
export function Icon({ name, size = 16, className, style }: { name: IconName; size?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} style={{ flex: 'none', ...style }} aria-hidden>
      {P[name]}
    </svg>
  );
}

// The sparkle marks AI features (Electric Blue, never violet).
export function Sparkle({ size = 15, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={'sparkle ' + className} aria-hidden>
      <path fill="currentColor" d="M12 2.5c.5 4.6 2.9 7 7.5 7.5-4.6.5-7 2.9-7.5 7.5-.5-4.6-2.9-7-7.5-7.5 4.6-.5 7-2.9 7.5-7.5z" />
      <path fill="currentColor" d="M19 15.5c.2 1.8 1.2 2.8 3 3-1.8.2-2.8 1.2-3 3-.2-1.8-1.2-2.8-3-3 1.8-.2 2.8-1.2 3-3z" opacity=".7" />
    </svg>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="spin" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// Six bars, like the BulletApply mark, filling as progress grows.
export function Bars({ value, total, n = 6, green }: { value: number; total: number; n?: number; green?: boolean }) {
  const on = total ? Math.round((value / total) * n) : 0;
  return (
    <span className={'bars' + (green ? ' green' : '')} title={`${value} of ${total}`}>
      {Array.from({ length: n }, (_, i) => <i key={i} className={i < on || (i === 0 && value > 0) ? 'on' : ''} />)}
    </span>
  );
}

export function Meter({ value, total }: { value: number; total: number }) {
  return <div className="meter"><div style={{ width: `${total ? (100 * value) / total : 0}%` }} /></div>;
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="ILE">
      <rect width="64" height="64" rx="15" fill="var(--ink)" />
      <rect x="12" y="16" width="40" height="7" rx="3.5" fill="var(--accent)" />
      <rect x="12" y="28.5" width="28" height="7" rx="3.5" fill="var(--accent)" />
      <rect x="12" y="41" width="18" height="7" rx="3.5" fill="var(--accent)" />
      <circle cx="46" cy="44.5" r="6" fill="var(--bg)" />
    </svg>
  );
}

// Models sometimes use \( \) / \[ \] delimiters; normalise them to $ for remark-math.
function normMath(s: string) {
  return (s || '')
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `$$${m}$$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m}$`);
}

export const Markdown = React.memo(function Markdown({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={'md ' + className}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
        components={{ a: (p) => <a {...p} target="_blank" rel="noopener" /> }}>
        {normMath(text)}
      </ReactMarkdown>
    </div>
  );
});

export function kindIcon(m: { type: string; kind: string }): IconName {
  if (m.type === 'youtube') return 'video';
  if (m.type === 'web') return 'globe';
  if (m.type === 'image') return 'image';
  return m.kind === 'apply' ? 'pen' : m.kind === 'solution' ? 'check' : 'book';
}

export function StatusDot({ status, title }: { status?: string | null; title?: string }) {
  return <span className={'dot ' + (status || 'none')} title={title || status || 'Not started'} />;
}

export function useToast() {
  const [msg, setMsg] = React.useState<string | null>(null);
  const t = React.useRef<any>(null);
  const show = React.useCallback((m: string) => {
    setMsg(m);
    clearTimeout(t.current);
    t.current = setTimeout(() => setMsg(null), 3200);
  }, []);
  const node = msg ? <div className="toast">{msg}</div> : null;
  return { show, node };
}

export function Modal({ onClose, children, width }: { onClose: () => void; children: React.ReactNode; width?: number }) {
  React.useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={width ? { maxWidth: width } : undefined}>{children}</div>
    </div>
  );
}
