import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import {
  ComposedChart, BarChart, Bar, Line, Scatter, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  ReferenceLine,
} from 'recharts';
import {
  Activity, GitBranch, ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { authHeaders } from '../lib/auth';
import { Badge } from '@/components/ui/badge';
import type {
  ModelAnalysis,
} from '../types';

const API = '/api/v1';

function SectionTitle({ children, color = 'var(--accent-primary)' }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-1 h-4 rounded-full" style={{ background: color }} />
      <h2 className="text-sm font-bold font-display" style={{ color: 'var(--text-primary)' }}>{children}</h2>
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl p-5 ${className}`} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      {children}
    </div>
  );
}

function CurveTooltip({ active, payload, label, isRoc }: {
  active?: boolean;
  payload?: Array<{ color: string; name: string; dataKey: string; value?: number; payload: Record<string, number> }>;
  label?: string | number;
  isRoc?: boolean;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const x = p.payload.fprKey ?? p.payload.recKey ?? label;
  return (
    <div className="rounded-xl p-3 shadow-2xl text-xs" style={{ background: 'rgba(9,9,26,0.95)', border: '1px solid var(--border)' }}>
      <div className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
        {isRoc ? 'FPR' : 'Rappel'} : {Number(x).toFixed(3)}
      </div>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
        <span style={{ color: 'var(--text-secondary)' }}>{isRoc ? 'TPR' : 'Précision'} :</span>
        <span className="font-mono font-bold" style={{ color: p.color }}>{Number(p.value).toFixed(3)}</span>
      </div>
    </div>
  );
}

function fmtNum(v: number | null | undefined, d = 3): string {
  if (v === undefined || v === null || Number.isNaN(v)) return '—';
  return v.toFixed(d);
}

function fmtPct(v: number | null | undefined, d = 1): string {
  if (v === undefined || v === null || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(d)}%`;
}

/* ═══════════════════════════════════════════════════════════════
   Langage — l'entrée de la page est chargée par AdvancedAnalyticsPage
   ═══════════════════════════════════════════════════════════════ */

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-48 gap-3 flex-col">
      <div className="w-6 h-6 border-2 rounded-full animate-spin"
        style={{ borderColor: 'var(--accent-primary)', borderTopColor: 'transparent' }} />
      <div className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{label}</div>
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-48 gap-2 text-center">
      <ShieldAlert className="w-8 h-8" style={{ color: 'var(--text-muted)' }} />
      <div className="text-sm max-w-md" style={{ color: 'var(--text-secondary)' }}>{message}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Section 1 — KPI du modèle
   ═══════════════════════════════════════════════════════════════ */

function Kpi({ label, value, color = 'var(--accent-primary)' }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-2xl px-4 py-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="text-[10px] font-mono uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      <div className="font-mono text-lg font-bold" style={{ color }}>{value}</div>
    </div>
  );
}

function ModelKpis({ analysis }: { analysis: ModelAnalysis }) {
  const m = analysis.model_meta;
  const kpis = [
    { label: 'ROC-AUC', value: fmtNum(m?.metrics.roc_auc) },
    { label: 'AP (PR)', value: fmtNum(m?.metrics.ap), color: '#FF2D78' },
    { label: 'F1', value: fmtNum(m?.metrics.f1) },
    { label: 'Rappel', value: fmtPct(m?.metrics.recall, 1) },
    { label: 'Précision', value: fmtPct(m?.metrics.precision, 1) },
    { label: 'FPR', value: fmtPct(m?.metrics.fpr, 2) },
    { label: 'Seuil (score)', value: fmtNum(m?.threshold, 2), color: '#FFC400' },
    { label: 'Échantillons', value: (analysis.sampled?.n_total ?? 0).toLocaleString('fr-FR') },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
      {kpis.map(k => <Kpi key={k.label} {...k} />)}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Section 2 — Courbes ROC & Precision-Recall
   ═══════════════════════════════════════════════════════════════ */

function RocCurveSection({ roc, pr }: { roc: ModelAnalysis['roc']; pr: ModelAnalysis['pr'] }) {
  const rocData = useMemo(() => {
    if (!roc?.points.length) return [];
    return [
      ...roc.points,
      ...(roc.op ? [{ x: roc.op.x, y: roc.op.y, fprKey: roc.op.fpr ?? roc.op.x, isOp: true }] : []),
    ];
  }, [roc]);
  const rocOp = roc?.op ? [roc.op] : [];

  const prData = useMemo(() => {
    if (!pr?.points.length) return [];
    return [
      ...pr.points,
      ...(pr.op ? [{ x: pr.op.x, y: pr.op.y, recKey: pr.op.recall ?? pr.op.x, isOp: true }] : []),
    ];
  }, [pr]);
  const prOp = pr?.op ? [pr.op] : [];

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card>
        <SectionTitle color="#00FFA3">Courbe ROC</SectionTitle>
        <div className="text-xs font-mono mb-3" style={{ color: 'var(--text-secondary)' }}>
          AUC = <span className="text-[#00FFA3] font-bold">{fmtNum(roc?.auc)}</span>
          {' '}· <span style={{ color: 'var(--text-muted)' }}>taux de vrais positifs vs taux de faux positifs</span>
        </div>
        {rocData.length ? (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={rocData} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
              <CartesianGrid stroke="rgba(148,163,184,0.12)" strokeDasharray="3 3" />
              <XAxis dataKey="x" type="number" domain={[0, 1]} tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} stroke="var(--border)" />
              <YAxis type="number" domain={[0, 1]} tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} stroke="var(--border)" />
              <Tooltip content={<CurveTooltip isRoc />} />
              <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]} stroke="rgba(148,163,184,0.35)" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="y" name="TPR" stroke="#00FFA3" strokeWidth={2} dot={false} isAnimationActive={false} legendType="none" />
              <Scatter data={rocOp} dataKey="y" name="Point de fonctionnement" fill="#FFFFFF" stroke="#00FFA3" shape={<circle r={5} />}>
                <Cell fill="#FFFFFF" stroke="#00FFA3" strokeWidth={2} />
              </Scatter>
            </ComposedChart>
          </ResponsiveContainer>
        ) : <ErrorBlock message="Courbe ROC indisponible." />}
        {roc?.op && (
          <div className="mt-3 text-xs font-mono flex flex-wrap gap-3" style={{ color: 'var(--text-secondary)' }}>
            <span>Point : TPR <b style={{ color: '#00FFA3' }}>{fmtNum(roc.op.tpr)}</b></span>
            <span>FPR <b style={{ color: '#FF2D78' }}>{fmtNum(roc.op.fpr)}</b></span>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle color="#FF2D78">Courbe Precision-Rappel</SectionTitle>
        <div className="text-xs font-mono mb-3" style={{ color: 'var(--text-secondary)' }}>
          AP = <span className="text-[#FF2D78] font-bold">{fmtNum(pr?.ap)}</span>
          {' '}· <span style={{ color: 'var(--text-muted)' }}>précision selon le rappel (classe d'attaque minoritaire)</span>
        </div>
        {prData.length ? (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={prData} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
              <CartesianGrid stroke="rgba(148,163,184,0.12)" strokeDasharray="3 3" />
              <XAxis dataKey="x" type="number" domain={[0, 1]} tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} stroke="var(--border)" />
              <YAxis type="number" domain={[0, 1]} tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} stroke="var(--border)" />
              <Tooltip content={<CurveTooltip />} />
              <Line type="monotone" dataKey="y" name="Précision" stroke="#FF2D78" strokeWidth={2} dot={false} isAnimationActive={false} legendType="none" />
              <Scatter data={prOp} dataKey="y" name="Point de fonctionnement" fill="#FFFFFF" stroke="#FF2D78" shape={<circle r={5} />}>
                <Cell fill="#FFFFFF" stroke="#FF2D78" strokeWidth={2} />
              </Scatter>
            </ComposedChart>
          </ResponsiveContainer>
        ) : <ErrorBlock message="Courbe Precision-Rappel indisponible." />}
        {pr?.op && (
          <div className="mt-3 text-xs font-mono flex flex-wrap gap-3" style={{ color: 'var(--text-secondary)' }}>
            <span>Rappel <b style={{ color: '#00FFA3' }}>{fmtNum(pr.op.recall)}</b></span>
            <span>Précision <b style={{ color: '#FF2D78' }}>{fmtNum(pr.op.precision)}</b></span>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Section 3 — Distribution des scores d'anomalie + seuil
   ═══════════════════════════════════════════════════════════════ */

function DistTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ color?: string; name?: string; value?: number; payload?: { atThreshold?: boolean } }>; label?: string | number }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl p-3 shadow-2xl text-xs" style={{ background: 'rgba(9,9,26,0.95)', border: '1px solid var(--border)' }}>
      <div className="font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Score ≈ {label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span style={{ color: 'var(--text-secondary)' }}>{p.name}:</span>
          <span className="font-mono font-bold" style={{ color: p.color }}>{Number(p.value).toLocaleString('fr-FR')}</span>
        </div>
      ))}
      {payload[0]?.payload?.atThreshold && (
        <div className="text-[10px] mt-1 flex items-center gap-1" style={{ color: '#FFC400' }}>
          <Sparkles className="w-3 h-3" /> Seuil de détection
        </div>
      )}
    </div>
  );
}

function DistributionSection({ distribution }: { distribution: ModelAnalysis['distribution'] }) {
  const data = useMemo(() => {
    if (!distribution?.bins.length) return [];
    const thr = distribution.threshold_value;
    const idxThreshold = distribution.threshold_bin;
    return distribution.bins.map((bin, i) => ({
      bin: Number(bin).toFixed(2),
      binValue: bin,
      i,
      Normal: distribution.normal[i] ?? 0,
      Attaque: distribution.attack[i] ?? 0,
      above: idxThreshold !== null && i >= idxThreshold,
      atThreshold: thr !== null && idxThreshold !== null && i === idxThreshold,
    }));
  }, [distribution]);

  if (!data.length) return null;
  const maxCount = Math.max(1, ...distribution?.normal ?? [], ...distribution?.attack ?? []);

  return (
    <Card>
      <SectionTitle color="#FFC400">
        Distribution des scores d'anomalie — seuil de détection
      </SectionTitle>
      <div className="text-xs font-mono mb-3" style={{ color: 'var(--text-secondary)' }}>
        Seuil : <span className="text-[#FFC400] font-bold">{fmtNum(distribution?.threshold_value, 2)}</span>
        {' '}· tout score ≥ seuil est signalé comme <span style={{ color: '#FF2D78' }}>attaque</span>
        <div className="mt-1 flex flex-wrap gap-2">
          <Badge variant="outline" className="text-[10px]"><span className="w-2 h-2 rounded-full bg-[#00FFA3] inline-block mr-1" /> Normal</Badge>
          <Badge variant="outline" className="text-[10px]"><span className="w-2 h-2 rounded-full bg-[#FF2D78] inline-block mr-1" /> Attaque</Badge>
          <Badge variant="outline" className="text-[10px]"><span className="w-2 h-2 rounded-full bg-[#FFC400] inline-block mr-1" /> Au-delà du seuil</Badge>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: -10 }} barCategoryGap="18%">
          <CartesianGrid stroke="rgba(148,163,184,0.12)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="bin" tick={{ fill: 'var(--text-secondary)', fontSize: 9 }} angle={-55} textAnchor="end" stroke="var(--border)" interval={4} />
          <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} stroke="var(--border)" />
          <Tooltip content={<DistTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} iconSize={9} />
          <ReferenceLine ifOverflow="extendDomain"
            x={data[data.findIndex(d => d.atThreshold)]?.bin ?? data[0]?.bin}
            stroke="#FFC400" strokeWidth={1.5} strokeDasharray="5 4"
            label={{ value: 'SEUIL', position: 'insideTopRight', fill: '#FFC400', fontSize: 10, fontFamily: 'monospace' }} />
          <Bar dataKey="Normal" fill="#00FFA3" fillOpacity={0.75} radius={[2, 2, 0, 0]} maxBarSize={10}>
            {data.map((d, i) => (
              <Cell key={i} fill="#00FFA3" fillOpacity={d.above ? 0.35 : 0.85} />
            ))}
          </Bar>
          <Bar dataKey="Attaque" fill="#FF2D78" radius={[2, 2, 0, 0]} maxBarSize={10}>
            {data.map((d, i) => (
              <Cell key={i} fill="#FF2D78" fillOpacity={d.above ? 1 : 0.4} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-2 h-1.5 relative" style={{ userSelect: 'none' }}>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{
          right: distribution && distribution.threshold_bin !== null && distribution.bins.length
            ? `${(distribution.threshold_bin / distribution.bins.length) * 100}%` : '0%',
          background: 'linear-gradient(90deg, rgba(0,255,163,0.5), rgba(255,45,120,0.35))',
        }} />
        <div className="absolute w-px bg-[#FFC400] inset-y-0 rounded"
          style={{ left: distribution && distribution.threshold_bin !== null && distribution.bins.length
            ? `${(distribution.threshold_bin / distribution.bins.length) * 100}%` : '0%' }} />
        <div className="absolute top-4 text-[9px] font-mono left-0" style={{ color: 'var(--text-secondary)' }}>Normal</div>
        <div className="absolute top-4 text-[9px] font-mono right-0" style={{ color: '#FF2D78' }}>Attaque →</div>
      </div>
      <div className="text-[10px] font-mono mt-6 text-right" style={{ color: 'var(--text-muted)' }}>
        bin {maxCount.toLocaleString('fr-FR')} occurrences max
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Section 4 — Réseau de corrélation inter-capteurs
   ═══════════════════════════════════════════════════════════════ */

type NetEdge = { x1: number; y1: number; x2: number; y2: number; weight: number; w: number; c: string; o: number; label: string };
type NetLayout = {
  positions: Record<string, { x: number; y: number; label: string; group: string }>;
  edges: NetEdge[];
};

function CorrelationNetwork({ correlations }: { correlations: ModelAnalysis['correlations'] }) {
  const [hoverEdge, setHoverEdge] = useState<number | null>(null);
  const layout = useMemo((): NetLayout => {
    if (!correlations?.nodes.length) return { positions: {}, edges: [] };

    const W = 800, H = 380, cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 70;
    const n = correlations.nodes.length;
    const positions: NetLayout['positions'] = {};
    correlations.nodes.forEach((node, i) => {
      const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
      positions[node.id] = { x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle), label: node.label, group: node.group };
    });

    const edges: NetEdge[] = correlations.edges.map(e => {
      const a = positions[e.source], b = positions[e.target];
      const w = Math.min(Math.abs(e.weight), 1);
      return {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        weight: e.weight,
        w: 0.5 + w * 3.5,
        c: e.weight >= 0 ? 'rgba(0,255,163,0.8)' : 'rgba(255,45,120,0.8)',
        o: 0.15 + w * 0.7,
        label: `${a.label}→${b.label}`,
      };
    });

    return { positions, edges };
  }, [correlations]);

  if (!correlations?.nodes.length) return <ErrorBlock message="Réseau de corrélation indisponible." />;

  return (
    <Card>
      <SectionTitle color="#8B5CF6">
        <span className="flex items-center gap-2"><GitBranch className="w-4 h-4" /> Corrélation inter-capteurs</span>
      </SectionTitle>
      <div className="flex flex-wrap gap-3 mb-3 text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
        <span><span className="w-2 h-2 rounded-full inline-block mr-1" style={{ background: 'rgba(0,255,163,0.9)' }} /> Corrélation positive</span>
        <span><span className="w-2 h-2 rounded-full inline-block mr-1" style={{ background: 'rgba(255,45,120,0.9)' }} /> Corrélation négative</span>
        <span>épaisseur ∝ |r|</span>
      </div>
      <div className="overflow-hidden rounded-xl" style={{ border: '1px solid var(--border)' }}>
        <svg viewBox="0 0 800 380" className="w-full h-auto" style={{ background: 'rgba(2,6,23,0.5)' }}>
          <defs>
            <radialGradient id="nodeHalo" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--accent-primary)" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Arêtes — apparition en cascade, flux d'énergie continu, grossissement au survol */}
          {layout.edges.map((e, i) => {
            const delay = 0.25 + i * 0.07;
            const mx = (e.x1 + e.x2) / 2, my = (e.y1 + e.y2) / 2;
            const isHover = hoverEdge === i;
            return (
              <g
                key={i}
                className="cursor-pointer"
                onMouseEnter={() => setHoverEdge(i)}
                onMouseLeave={() => setHoverEdge(null)}
              >
                <motion.line
                  x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
                  stroke={e.c}
                  strokeLinecap="round"
                  pathLength={1} strokeDasharray="1"
                  initial={{ strokeDashoffset: 1 }}
                  animate={{ strokeDashoffset: 0 }}
                  transition={{ duration: 0.7, delay, ease: 'easeOut' }}
                />
                <motion.line
                  x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
                  strokeLinecap="round"
                  animate={{
                    stroke: isHover ? '#FFFFFF' : e.c,
                    strokeWidth: isHover ? Math.min(16, e.w * 2.4) : e.w,
                    strokeOpacity: isHover ? 1 : e.o,
                  }}
                  transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                >
                  <title>{`${e.label} : r = ${e.weight.toFixed(3)}`}</title>
                </motion.line>
                <motion.line
                  x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}
                  stroke="#FFFFFF" strokeOpacity={isHover ? 0.95 : 0.65}
                  strokeWidth={isHover ? Math.max(2.5, e.w * 0.9) : Math.max(1.5, e.w * 0.6)}
                  strokeLinecap="round"
                  pathLength={1} strokeDasharray="0.09 0.91"
                  initial={{ strokeDashoffset: 0.3, opacity: 0 }}
                  animate={{ strokeDashoffset: isHover ? -2 : -1, opacity: 1 }}
                  transition={{
                    strokeDashoffset: { duration: isHover ? 0.5 : 1.6 + (1 - Math.abs(e.weight)) * 1.6, delay, ease: 'linear', repeat: Infinity },
                    opacity: { duration: 0.3, delay },
                  }}
                >
                  <title>{`${e.label} : r = ${e.weight.toFixed(3)}`}</title>
                </motion.line>

                {isHover && (
                  <motion.g
                    pointerEvents="none"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                  >
                    <rect
                      x={mx - 78} y={my - 13} width="156" height="24" rx="12"
                      fill="rgba(9,9,26,0.95)" stroke={e.c} strokeWidth="1"
                    />
                    <text x={mx} y={my + 3.5} textAnchor="middle" fontSize="11"
                      fontFamily="monospace" fontWeight="bold"
                      fill={e.weight >= 0 ? '#00FFA3' : '#FF2D78'}>
                      {e.label} · r = {e.weight.toFixed(3)}
                    </text>
                  </motion.g>
                )}
              </g>
            );
          })}

          {/* Nœuds — halo pulsant + anneau tournant + apparition en pop */}
          {Object.entries(layout.positions).map(([id, p], i) => {
            const delay = 0.5 + i * 0.09;
            const ringColor = p.group === 'delta' ? '#00FFA3' : '#8B5CF6';
            return (
              <motion.g
                key={id}
                className="cursor-pointer"
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 18, delay }}
                whileHover={{ scale: 1.18 }}
              >
                <motion.circle
                  cx={p.x} cy={p.y} r="34" fill="url(#nodeHalo)"
                  animate={{ opacity: [0.45, 0.9, 0.45] }}
                  transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut', delay }}
                />
                <motion.circle
                  cx={p.x} cy={p.y} r="23" fill="none" stroke={ringColor} strokeOpacity={0.55}
                  strokeWidth="1" strokeLinecap="round" strokeDasharray="2 7"
                  animate={{ strokeDashoffset: [0, -9] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'linear', delay }}
                />
                <circle cx={p.x} cy={p.y} r="18" fill="var(--accent-primary)"
                  fillOpacity={0.12} stroke={ringColor} strokeWidth="1.5">
                  <title>{`${p.label} (${id})`}</title>
                </circle>
                <text x={p.x} y={p.y + 3} textAnchor="middle" fill="var(--text-primary)"
                  fontSize="10" fontFamily="monospace" fontWeight="bold">{p.label}</text>
              </motion.g>
            );
          })}
        </svg>
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Page principale
   ═══════════════════════════════════════════════════════════════ */

const EMPTY: ModelAnalysis = { available: false, error: null };

export default function AdvancedAnalyticsPage() {
  const [analysis, setAnalysis] = useState<ModelAnalysis>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const aRes = await fetch(`${API}/advanced-analytics/model-analysis`, { headers: authHeaders() });
        const aData = await aRes.json();
        if (!alive) return;
        if (!aRes.ok) throw new Error(`model-analysis HTTP ${aRes.status}`);
        setAnalysis(aData);
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{
          background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-purple))',
        }}>
          <Activity className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-display text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Analyse approfondie du modèle</h1>
          <p className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
            Performance du détecteur OCSVM multivarié · {analysis.sampled?.n_total.toLocaleString('fr-FR') ?? '—'} échantillons (
            {analysis.sampled?.n_normal ?? '—'} normaux · {analysis.sampled?.n_attack ?? '—'} attaques)
          </p>
        </div>
      </div>

      {loading ? <LoadingBlock label="Calcul des courbes ROC / PR, corrélations…" /> : err ? (
        <Card><ErrorBlock message={`Impossible de charger l'analyse : ${err}.`} /></Card>
      ) : !analysis.available ? (
        <Card><ErrorBlock message={analysis.error ?? 'Analyse indisponible.'} /></Card>
      ) : (
        <div className="space-y-4">
          <ModelKpis analysis={analysis} />

          <RocCurveSection roc={analysis.roc} pr={analysis.pr} />

          {analysis.distribution && <DistributionSection distribution={analysis.distribution} />}

          <CorrelationNetwork correlations={analysis.correlations} />
        </div>
      )}
    </div>
  );
}