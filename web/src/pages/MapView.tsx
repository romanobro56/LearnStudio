// The "knowledge web": Source sections on the left, Apply problems on the right, links between them.
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, materialLink } from '../api';
import { Spinner } from '../components/ui';

const ROW = 26;
const W = 1040;
const LX = 300;
const RX = W - 300;

export function MapView({ courseId, units }: { courseId: string; units: any[] }) {
  const [data, setData] = useState<any>(null);
  const [from, setFrom] = useState(1);
  const [span, setSpan] = useState(3);
  const [hot, setHot] = useState<string | null>(null);
  const nav = useNavigate();
  useEffect(() => { api(`/courses/${courseId}/map`).then(setData); }, [courseId]);
  const maxUnit = Math.max(1, ...(units || []).map((u: any) => u.idx));

  const view = useMemo(() => {
    if (!data) return null;
    const inRange = (u: number | null) => u == null || (u >= from && u < from + span);
    const probs = data.problems.filter((p: any) => inRange(p.unit_idx));
    const pset = new Set(probs.map((p: any) => p.id));
    const links = data.links.filter((l: any) => pset.has(l.problem_id));
    const sids = new Set(links.map((l: any) => l.section_id));
    const secs = data.sections.filter((s: any) => inRange(s.unit_idx) || sids.has(s.id));
    const sy = new Map<string, number>(secs.map((s: any, i: number) => [s.id, 30 + i * ROW]));
    const py = new Map<string, number>(probs.map((p: any, i: number) => [p.id, 30 + i * ROW]));
    const h = 50 + Math.max(secs.length, probs.length) * ROW;
    // Spread the shorter column so links fan out evenly.
    const scale = (m: Map<string, number>, n: number) => {
      const f = n > 1 ? (h - 70) / ((n - 1) * ROW) : 1;
      if (f > 1) for (const [k, v] of m) m.set(k, 30 + (v - 30) * f);
    };
    scale(sy, secs.length); scale(py, probs.length);
    return { secs, probs, links: links.filter((l: any) => sy.has(l.section_id)), sy, py, h };
  }, [data, from, span]);

  if (!data || !view) return <div className="row steel"><Spinner /> Drawing the web</div>;
  const connected = new Set<string>();
  if (hot) for (const l of view.links) if (l.section_id === hot || l.problem_id === hot) { connected.add(l.section_id); connected.add(l.problem_id); }

  return (
    <div>
      <div className="row wrap" style={{ marginBottom: 12, gap: 12 }}>
        <span className="small steel">Units</span>
        <input type="range" min={1} max={maxUnit} value={from} onChange={(e) => setFrom(Number(e.target.value))} style={{ width: 220, accentColor: 'var(--accent)' }} />
        <span className="small mono">{from} to {Math.min(maxUnit, from + span - 1)}</span>
        <div className="seg">{[1, 3, 6].map((n) => <button key={n} className={span === n ? 'on' : ''} onClick={() => setSpan(n)}>{n} unit{n > 1 ? 's' : ''}</button>)}</div>
        <span className="small steel">{view.secs.length} sections, {view.probs.length} problems, {view.links.length} links. Hover to trace, click to open.</span>
      </div>
      <div className="map-wrap">
        <svg width={W} height={view.h} style={{ display: 'block', minWidth: W }}>
          <text x={LX - 10} y={16} textAnchor="end" fontSize={11} fontWeight={600} fill="var(--steel)">SOURCE</text>
          <text x={RX + 10} y={16} fontSize={11} fontWeight={600} fill="var(--steel)">APPLY</text>
          {view.links.map((l: any, i: number) => {
            const y1 = view.sy.get(l.section_id)!;
            const y2 = view.py.get(l.problem_id)!;
            const on = hot && (l.section_id === hot || l.problem_id === hot);
            return <path key={i} d={`M${LX},${y1} C${(LX + RX) / 2},${y1} ${(LX + RX) / 2},${y2} ${RX},${y2}`} fill="none"
              stroke={on ? 'var(--accent)' : 'var(--mist-3)'} strokeOpacity={hot && !on ? 0.25 : 0.9} strokeWidth={on ? 2 : 1 + (l.score || 0.5)} />;
          })}
          {view.secs.map((s: any) => {
            const y = view.sy.get(s.id)!;
            const dim = hot && !connected.has(s.id) && hot !== s.id;
            return (
              <g key={s.id} style={{ cursor: 'pointer', opacity: dim ? 0.35 : 1 }} onMouseEnter={() => setHot(s.id)} onMouseLeave={() => setHot(null)} onClick={() => nav(materialLink(s.material_id, { section: s.id }))}>
                <text x={LX - 14} y={y + 4} textAnchor="end" fontSize={12} fill="var(--ink)">{trim(`${s.short_title}: ${s.title}`, 44)}</text>
                <circle cx={LX} cy={y} r={5.5} fill={s.status === 'read' ? 'var(--green)' : 'var(--bg)'} stroke={hot === s.id ? 'var(--accent)' : 'var(--steel)'} strokeWidth={1.5} />
              </g>
            );
          })}
          {view.probs.map((p: any) => {
            const y = view.py.get(p.id)!;
            const dim = hot && !connected.has(p.id) && hot !== p.id;
            const fill = p.status === 'solved' ? 'var(--green)' : p.status === 'attempted' ? 'var(--amber)' : 'var(--bg)';
            return (
              <g key={p.id} style={{ cursor: 'pointer', opacity: dim ? 0.35 : 1 }} onMouseEnter={() => setHot(p.id)} onMouseLeave={() => setHot(null)} onClick={() => nav(materialLink(p.material_id, { problem: p.id }))}>
                <rect x={RX - 6} y={y - 6} width={12} height={12} rx={3} fill={fill} stroke={hot === p.id ? 'var(--accent)' : 'var(--accent)'} strokeWidth={1.5} />
                <text x={RX + 14} y={y + 4} fontSize={12} fill="var(--ink)">{trim(`${p.short_title} ${p.label}${p.title ? ': ' + p.title : ''}`, 44)}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

const trim = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
