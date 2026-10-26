/**
 * Vue d'ensemble — chaque chiffre de cette page vient de GET /api/v1/overview, qui ne lit que
 * la base de données (transmission_runs, transmission_model_results, devices, telemetry,
 * ml_models, model_metrics, users, audit_logs). Aucun chiffre écrit en dur.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  RefreshCw, Database, Cpu, Users, Trophy, Clock, BellRing, Crosshair, Target,
  AlertTriangle, CheckCircle2, XCircle, MinusCircle, ArrowRight, History, Info,
} from 'lucide-react';
import { authHeaders } from '../lib/auth';
import { useTheme } from '../contexts/ThemeContext';

// ─── Types de la réponse ─────────────────────────────────────────────────────
interface ModelRow {
  modele: string; nom: string; type: string; meilleur: boolean;
  recall: number | null; precision: number | null; f1: number | null; f2: number | null;
  roc_auc: number | null; avg_precision: number | null; fpr: number | null;
  fausses_alarmes_par_heure: number | null; delai_median_min: number | null;
  episodes: number | null; episodes_detectes: number | null; seuil: number | null;
  val_f1: number | null; val_recall: number | null; val_precision: number | null; val_fausses_alarmes_par_heure: number | null;
}
interface Point { cle: string; libelle: string; seuil: number | null; recall: number | null; precision: number | null;
  f1: number | null; f2: number | null; fausses_alarmes_par_heure: number | null; delai_median_min: number | null }
interface Scenario { scenario: string; lignes: number; detectees: number; taux: number | null; episodes: number;
  episodes_detectes: number; delai_median_min: number | null }
interface Split { lignes: number; attaques: number; part: number }
interface LastRun {
  id: number; debut: string; fin: string | null; duree_s: number | null; lance_par: string | null;
  meilleur_modele: string | null; meilleur_f1: number | null; classement_validation: string[]; cible_rappel: number | null;
  modeles: ModelRow[]; points_meilleur: Point[]; par_scenario: Scenario[];
  donnees: { fichier: string | null; lignes: number; features: number; episodes: number; scenarios: number;
    train: number | null; val: number | null; test: number | null; attaques_train: number | null; attaques_val: number | null;
    attaques_test: number | null; prevalence: Record<string, Split> | null };
}
interface HistoryRow { id: number; date: string; duree_s: number | null; meilleur_modele: string | null; f1: number | null;
  recall: number | null; precision: number | null; fausses_alarmes_par_heure: number | null; delai_median_min: number | null;
  lignes: number; candidats: string[] }
interface Overview {
  entrainements: { total: number; par_statut: Record<string, number>; premier: string | null; dernier: string | null;
    dernier_lancement: null | { id: number; debut: string; fin: string | null; statut: string; lance_par: string | null; duree_s: number | null; erreur: string | null } };
  dernier_entrainement: LastRun | null;
  historique: HistoryRow[];
  capteurs: { total: number; en_ligne: number; par_type: Record<string, number>;
    liste: { id: string; nom: string; type: string; statut: string; emplacement: string; vu_le: string | null }[] };
  telemetrie: { mesures: number; appareils: number; debut: string | null; fin: string | null };
  modeles_phase2: { modeles: number; dernier_entrainement: string | null; metriques_par_attaque: number };
  comptes: { total: number; actifs: number; par_role: Record<string, number> };
  audit: { actions: number; derniere: string | null };
  sources: Record<string, string>;
}

// ─── Formatage (français) ────────────────────────────────────────────────────
const nf = (v: number | null | undefined, d = 0) =>
  v == null ? '—' : v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v: number | null | undefined, d = 1) => (v == null ? '—' : `${nf(v * 100, d)} %`);
const dateFr = (iso: string | null | undefined, withTime = true) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return withTime
    ? d.toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
};
const duree = (s: number | null | undefined) => {
  if (s == null) return '—';
  const m = Math.floor(s / 60);
  return m ? `${m} min ${String(Math.round(s % 60)).padStart(2, '0')} s` : `${Math.round(s)} s`;
};
const STATUT: Record<string, { label: string; color: string }> = {
  termine: { label: 'Terminé', color: 'var(--accent-success)' },
  erreur: { label: 'Erreur', color: 'var(--accent-danger)' },
  interrompu: { label: 'Interrompu', color: 'var(--accent-warning)' },
  en_cours: { label: 'En cours', color: 'var(--accent-primary)' },
};
const SCENARIO_FR: Record<string, string> = {
  MITM_gel: 'MITM · gel du frigo', MITM_rejeu: 'MITM · rejeu du frigo', Injection_nominale: 'Injection · valeurs nominales',
  'Injection_biais_0.5': 'Injection · biais −0,5 °C', 'Injection_biais_1.0': 'Injection · biais −1 °C',
  'Injection_biais_2.0': 'Injection · biais −2 °C', Injection_derive: 'Injection · dérive lente',
  MITM_gel_thermostat: 'MITM · gel du thermostat', Injection_biais_thermostat: 'Injection · biais thermostat',
};
const DEVICE_FR: Record<string, string> = { fridge: 'Chambre froide', thermostat: 'Thermostat', weather: 'Météo', gateway: 'Passerelle' };
const ROLE_FR: Record<string, string> = { admin: 'administrateur', operator: 'opérateur' };
// Palette catégorielle validée (3 premiers créneaux), clair / sombre
const SERIES = {
  light: ['#2a78d6', '#eb6834', '#1baf7a'],
  dark: ['#3987e5', '#d95926', '#199e70'],
};

// ─── Briques de mise en page ─────────────────────────────────────────────────
function Section({ title, subtitle, source, action, children }: {
  title: string; subtitle?: ReactNode; source?: string; action?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="vc-card overflow-hidden min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
          {subtitle && <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
      {source && (
        <div className="px-5 py-2 text-[11px] flex items-center gap-1.5" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-subtle)', color: 'var(--text-muted)' }}>
          <Database className="w-3 h-3 shrink-0" /> <span className="truncate">Source : <code className="font-mono">{source}</code></span>
        </div>
      )}
    </section>
  );
}

function Stat({ icon, label, value, sub, tone }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="vc-card p-4 min-w-0">
      <div className="flex items-center gap-2 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
        <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
          style={{ background: 'var(--bg-subtle)', color: tone ?? 'var(--accent-primary)', border: '1px solid var(--border)' }}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-3 text-[26px] leading-none font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{value}</div>
      {sub && <div className="mt-2 text-xs leading-snug" style={{ color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg p-4 text-sm" style={{ background: 'var(--bg-subtle)', color: 'var(--text-secondary)', border: '1px dashed var(--border-strong)' }}>
      <Info className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
      <div>{children}</div>
    </div>
  );
}

function Meter({ value, color = 'var(--accent-primary)' }: { value: number | null; color?: string }) {
  return (
    <div className="h-1.5 rounded-full overflow-hidden w-full" style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)' }}>
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%`, background: color }} />
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function OverviewPage() {
  const { theme } = useTheme();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/v1/overview', { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
      setError(null);
      setLoadedAt(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const colors = SERIES[theme === 'dark' ? 'dark' : 'light'];

  if (!data) {
    return (
      <div className="space-y-4">
        <PageHeader loading={loading} loadedAt={loadedAt} onRefresh={load} />
        {error ? <Empty>Impossible de lire la vue d’ensemble ({error}).</Empty> : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map(i => <div key={i} className="vc-card h-28 animate-pulse" />)}
          </div>
        )}
      </div>
    );
  }

  const run = data.dernier_entrainement;
  const best = run?.modeles.find(m => m.meilleur) ?? null;
  const e = data.entrainements;
  const histo = data.historique.map(h => ({
    ...h,
    label: `#${h.id} · ${new Date(h.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`,
    F1: h.f1, Rappel: h.recall, 'Précision': h.precision,
  }));
  const testSplit = run?.donnees.prevalence?.test;

  return (
    <div className="space-y-5">
      <PageHeader loading={loading} loadedAt={loadedAt} onRefresh={load} />
      {error && <Empty>Dernière actualisation impossible ({error}) ; les chiffres affichés sont ceux du chargement précédent.</Empty>}

      {/* ── Bandeau : meilleur modèle du dernier entraînement ───────────── */}
      {run && best ? (
        <div className="vc-card p-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--accent-glow)', color: 'var(--accent-primary)' }}>
                <Trophy className="w-5 h-5" />
              </span>
              <div className="min-w-0">
                <div className="vc-kicker">Meilleur modèle · entraînement #{run.id}</div>
                <div className="text-lg font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{best.nom}</div>
              </div>
            </div>
            <div className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Retenu sur la validation parmi {run.modeles.length} modèles ({run.classement_validation.join(' › ') || '—'}).<br />
              Mesures sur le jeu de test{testSplit ? ` (${nf(testSplit.lignes)} lignes, ${pct(testSplit.part)} d’attaques)` : ''}, au seuil max-F1 choisi sur la validation.
              {' '}Terminé le {dateFr(run.fin)} · {duree(run.duree_s)}{run.lance_par ? ` · lancé par ${run.lance_par}` : ''}.
            </div>
          </div>
        </div>
      ) : (
        <Empty>
          Aucun entraînement terminé n’est enregistré dans <code>transmission_runs</code>.{' '}
          <Link to="/dashboard/transmission" style={{ color: 'var(--accent-primary)' }}>Lancer un entraînement depuis la page Transmission</Link>.
        </Empty>
      )}

      {/* ── Indicateurs clés du meilleur modèle ─────────────────────────── */}
      {best && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="kpi-meilleur">
          <Stat icon={<Target className="w-4 h-4" />} label="Rappel (test)" value={pct(best.recall)}
            sub={<>Part des lignes attaquées détectées · validation {pct(best.val_recall)}</>} />
          <Stat icon={<BellRing className="w-4 h-4" />} label="Fausses alertes / heure" value={nf(best.fausses_alarmes_par_heure, 2)}
            tone="var(--accent-warning)" sub={<>Alertes sans attaque, par heure de trafic normal · validation {nf(best.val_fausses_alarmes_par_heure, 2)}</>} />
          <Stat icon={<Clock className="w-4 h-4" />} label="Délai médian de détection"
            value={best.delai_median_min == null ? '—' : <>{nf(best.delai_median_min, 1)}<span className="text-base font-medium"> min</span></>}
            sub={<>{nf(best.episodes_detectes)} / {nf(best.episodes)} épisodes d’attaque détectés</>} />
          <Stat icon={<Crosshair className="w-4 h-4" />} label="Précision (test)" value={pct(best.precision)}
            sub={<>F1 {nf(best.f1, 3)} · F2 {nf(best.f2, 3)} · ROC-AUC {nf(best.roc_auc, 3)}</>} />
        </div>
      )}

      {/* ── Contexte : volume en base ───────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={<History className="w-4 h-4" />} label="Entraînements enregistrés" value={nf(e.total)}
          sub={e.total ? <>{Object.entries(e.par_statut).map(([s, n]) => `${n} ${(STATUT[s]?.label ?? s).toLowerCase()}${n > 1 && s !== 'en_cours' ? 's' : ''}`).join(' · ')}<br />dernier le {dateFr(e.dernier)}</> : 'Aucun entraînement en base'} />
        <Stat icon={<Database className="w-4 h-4" />} label="Lignes du jeu (dernier entr.)" value={run ? nf(run.donnees.lignes) : '—'}
          sub={run ? <>{nf(run.donnees.features)} variables · {nf(run.donnees.episodes)} épisodes · {nf(run.donnees.scenarios)} scénarios</> : 'Aucun entraînement terminé'} />
        <Stat icon={<Cpu className="w-4 h-4" />} label="Capteurs déclarés" value={nf(data.capteurs.total)}
          sub={data.capteurs.total ? <>{nf(data.capteurs.en_ligne)} en ligne · {Object.entries(data.capteurs.par_type).map(([t, n]) => `${n} ${(DEVICE_FR[t] ?? t).toLowerCase()}`).join(', ')}</> : 'Table devices vide'} />
        <Stat icon={<Users className="w-4 h-4" />} label="Comptes utilisateurs" value={nf(data.comptes.total)}
          sub={data.comptes.total ? <>{nf(data.comptes.actifs)} actif{data.comptes.actifs > 1 ? 's' : ''} · {Object.entries(data.comptes.par_role).map(([r, n]) => `${n} ${ROLE_FR[r] ?? r}${n > 1 ? 's' : ''}`).join(', ')}</> : 'Aucun compte'} />
      </div>

      {/* ── Comparaison des modèles du dernier entraînement ─────────────── */}
      <Section title="Modèles du dernier entraînement"
        subtitle="Jeu de test, au seuil max-F1 choisi sur la validation. Le meilleur modèle est retenu sur la validation, pas sur le test."
        source="transmission_model_results (run du dernier entraînement) + transmission_runs.result_json pour F2">
        {run && run.modeles.length ? (
          <div className="overflow-x-auto -mx-5">
            <table className="vc-table w-full text-sm min-w-[760px]" data-testid="table-modeles">
              <thead>
                <tr>
                  <th className="pl-5">Modèle</th><th className="vc-num">Rappel</th><th className="vc-num">Précision</th>
                  <th className="vc-num">F1</th><th className="vc-num">F2</th><th className="vc-num">Fausses alertes/h</th>
                  <th className="vc-num">Délai médian</th><th className="vc-num">Épisodes</th><th className="vc-num pr-5">F1 validation</th>
                </tr>
              </thead>
              <tbody>
                {run.modeles.map(m => (
                  <tr key={m.modele}>
                    <td className="pl-5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{m.nom}</span>
                        {m.meilleur && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'var(--accent-glow)', color: 'var(--accent-primary)' }}>RETENU</span>}
                      </div>
                    </td>
                    <td className="vc-num">
                      <div className="flex items-center justify-end gap-2"><span className="w-12 hidden sm:block"><Meter value={(m.recall ?? 0) * 100} /></span>{pct(m.recall)}</div>
                    </td>
                    <td className="vc-num">{pct(m.precision)}</td>
                    <td className="vc-num">{nf(m.f1, 3)}</td>
                    <td className="vc-num">{nf(m.f2, 3)}</td>
                    <td className="vc-num">{nf(m.fausses_alarmes_par_heure, 2)}</td>
                    <td className="vc-num">{m.delai_median_min == null ? '—' : `${nf(m.delai_median_min, 1)} min`}</td>
                    <td className="vc-num">{nf(m.episodes_detectes)} / {nf(m.episodes)}</td>
                    <td className="vc-num pr-5">{nf(m.val_f1, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>Aucun résultat de modèle en base pour l’instant.</Empty>}
      </Section>

      <div className="grid gap-5 xl:grid-cols-5">
        {/* ── Détection par scénario ──────────────────────────────────── */}
        <div className="xl:col-span-3 min-w-0">
          <Section title={best ? `Détection par scénario — ${best.nom}` : 'Détection par scénario'}
            subtitle="Part des lignes attaquées détectées sur le test. Les scénarios absents du bloc de test sont listés à part."
            source="transmission_model_results.per_attack / per_episode (meilleur modèle)">
            {run && run.par_scenario.length ? <ScenarioBars rows={run.par_scenario} /> : <Empty>Pas de détail par scénario en base.</Empty>}
          </Section>
        </div>

        {/* ── Points de fonctionnement ─────────────────────────────────── */}
        <div className="xl:col-span-2 min-w-0">
          <Section title="Compromis rappel / fausses alertes"
            subtitle={run?.cible_rappel ? `Seuils fixés sur la validation ; rappel cible retenu : ${nf(run.cible_rappel, 2)}. Mesures sur le test.` : 'Seuils fixés sur la validation, mesures sur le test.'}
            source="transmission_runs.result_json → modeles.<meilleur>.points_fonctionnement">
            {run && run.points_meilleur.length ? (
              <div className="overflow-x-auto -mx-5">
                <table className="vc-table w-full text-sm" data-testid="table-points">
                  <thead><tr><th className="pl-5">Point</th><th className="vc-num">Rappel</th><th className="vc-num">Précision</th><th className="vc-num pr-5">Fausses alertes/h</th></tr></thead>
                  <tbody>
                    {run.points_meilleur.map(p => (
                      <tr key={p.cle}>
                        <td className="pl-5 whitespace-nowrap">{p.cle === 'max_f1' ? 'max F1' : `Rappel cible ${p.cle.replace('rappel_', '').replace('.', ',')}`}</td>
                        <td className="vc-num">{pct(p.recall)}</td>
                        <td className="vc-num">{pct(p.precision)}</td>
                        <td className="vc-num pr-5">{nf(p.fausses_alarmes_par_heure, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty>Aucun point de fonctionnement enregistré pour ce modèle.</Empty>}
          </Section>
        </div>
      </div>

      {/* ── Historique ─────────────────────────────────────────────────── */}
      <Section title="Historique des entraînements"
        subtitle="Meilleur modèle de chaque entraînement terminé, mesuré sur son jeu de test. Les candidats et le découpage peuvent changer d’un entraînement à l’autre : la courbe montre l’évolution du protocole autant que celle des modèles."
        source="transmission_runs JOIN transmission_model_results (is_best) WHERE status = 'termine'"
        action={<Link to="/dashboard/transmission" className="text-xs font-medium inline-flex items-center gap-1" style={{ color: 'var(--accent-primary)' }}>Page Transmission <ArrowRight className="w-3 h-3" /></Link>}>
        {histo.length ? (
          <div className="space-y-5">
            {histo.length > 1 ? (
              <div className="h-64" data-testid="chart-historique" role="img" aria-label="Évolution du F1, du rappel et de la précision du meilleur modèle par entraînement">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={histo} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} interval={0} padding={{ left: 24, right: 24 }} />
                    <YAxis domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)} %`} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
                    <Tooltip formatter={(v) => pct(typeof v === 'number' ? v : null)} />
                    <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
                    {(['F1', 'Rappel', 'Précision'] as const).map((k, i) => (
                      <Line key={k} type="linear" dataKey={k} stroke={colors[i]} strokeWidth={2}
                        dot={{ r: 4, strokeWidth: 2, fill: 'var(--bg-card)' }} activeDot={{ r: 5 }} isAnimationActive={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : null}
            <div className="overflow-x-auto -mx-5">
              <table className="vc-table w-full text-sm min-w-[820px]" data-testid="table-historique">
                <thead><tr><th className="pl-5">Entraînement</th><th>Date</th><th>Meilleur modèle</th><th>Candidats</th><th className="vc-num">F1</th><th className="vc-num">Rappel</th><th className="vc-num">Précision</th><th className="vc-num">Fausses alertes/h</th><th className="vc-num pr-5">Durée</th></tr></thead>
                <tbody>
                  {[...data.historique].reverse().map(h => (
                    <tr key={h.id}>
                      <td className="pl-5 font-medium">#{h.id}</td>
                      <td className="whitespace-nowrap">{dateFr(h.date)}</td>
                      <td>{h.meilleur_modele ?? '—'}</td>
                      <td className="text-xs" style={{ color: 'var(--text-secondary)' }}>{h.candidats.join(', ') || '—'}</td>
                      <td className="vc-num">{nf(h.f1, 3)}</td>
                      <td className="vc-num">{pct(h.recall)}</td>
                      <td className="vc-num">{pct(h.precision)}</td>
                      <td className="vc-num">{nf(h.fausses_alarmes_par_heure, 2)}</td>
                      <td className="vc-num pr-5 whitespace-nowrap">{duree(h.duree_s)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : <Empty>Aucun entraînement terminé en base : l’historique apparaîtra après le premier entraînement.</Empty>}
        {e.dernier_lancement && e.dernier_lancement.statut !== 'termine' && (
          <div className="mt-4 text-xs flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
            <AlertTriangle className="w-3.5 h-3.5" style={{ color: STATUT[e.dernier_lancement.statut]?.color }} />
            Dernier lancement #{e.dernier_lancement.id} ({dateFr(e.dernier_lancement.debut)}) : {STATUT[e.dernier_lancement.statut]?.label ?? e.dernier_lancement.statut}
            {e.dernier_lancement.erreur ? ` — ${e.dernier_lancement.erreur}` : ''}
          </div>
        )}
      </Section>

      <div className="grid gap-5 lg:grid-cols-2 items-start">
        {/* ── Découpage du jeu ────────────────────────────────────────── */}
        <Section title="Découpage du jeu de données" subtitle={run?.donnees.fichier ? `Fichier ${run.donnees.fichier}, découpage en blocs temporels (dernier entraînement)` : undefined}
          source="transmission_runs.dataset (dernier entraînement terminé)">
          {run?.donnees.prevalence ? (
            <div className="space-y-3.5">
              {(['train', 'val', 'test'] as const).map(k => {
                const s = run.donnees.prevalence?.[k];
                if (!s) return null;
                const total = run.donnees.lignes || 1;
                return (
                  <div key={k}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{k === 'train' ? 'Apprentissage' : k === 'val' ? 'Validation' : 'Test'}</span>
                      <span className="tabular-nums text-xs" style={{ color: 'var(--text-secondary)' }}>{nf(s.lignes)} lignes · {nf(s.attaques)} attaquées ({pct(s.part)})</span>
                    </div>
                    <div className="mt-1.5 h-2.5 rounded-full overflow-hidden flex gap-[2px]" style={{ width: `${Math.max(8, (s.lignes / total) * 100)}%` }}>
                      <div style={{ width: `${(1 - s.part) * 100}%`, background: colors[0] }} />
                      <div style={{ width: `${s.part * 100}%`, background: colors[1] }} />
                    </div>
                  </div>
                );
              })}
              <div className="flex gap-4 text-xs pt-1" style={{ color: 'var(--text-secondary)' }}>
                <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: colors[0] }} /> lignes normales</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: colors[1] }} /> lignes attaquées</span>
              </div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Largeur des barres proportionnelle au nombre de lignes ; les lignes de garde entre blocs ne sont pas évaluées.</div>
            </div>
          ) : <Empty>Pas de découpage enregistré pour le dernier entraînement.</Empty>}
        </Section>

        {/* ── Parc et données temps réel ──────────────────────────────── */}
        <Section title="Capteurs et activité de la plateforme" source="devices · telemetry · ml_models · model_metrics · audit_logs">
          {data.capteurs.liste.length ? (
            <ul className="divide-y -mt-2" style={{ borderColor: 'var(--border)' }}>
              {data.capteurs.liste.map(d => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2.5" style={{ borderColor: 'var(--border)' }}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{d.nom}</div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{d.id} · {DEVICE_FR[d.type] ?? d.type} · vu le {dateFr(d.vu_le)}</div>
                  </div>
                  <span className="text-xs inline-flex items-center gap-1 shrink-0" style={{ color: d.statut === 'online' ? 'var(--accent-success)' : 'var(--text-muted)' }}>
                    {d.statut === 'online' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                    {d.statut === 'online' ? 'en ligne' : 'hors ligne'}
                  </span>
                </li>
              ))}
            </ul>
          ) : <Empty>Aucun capteur déclaré dans la table <code>devices</code>.</Empty>}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 mt-4 pt-4 text-sm" style={{ borderTop: '1px solid var(--border)' }}>
            <div><dt className="vc-kicker">Mesures temps réel</dt><dd className="mt-1 tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {nf(data.telemetrie.mesures)}{data.telemetrie.mesures ? <span className="text-xs" style={{ color: 'var(--text-muted)' }}> · {dateFr(data.telemetrie.debut)} → {dateFr(data.telemetrie.fin)}</span> : null}</dd></div>
            <div><dt className="vc-kicker">Modèles phase 2</dt><dd className="mt-1 tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {nf(data.modeles_phase2.modeles)}<span className="text-xs" style={{ color: 'var(--text-muted)' }}> · {nf(data.modeles_phase2.metriques_par_attaque)} métriques par attaque</span></dd></div>
            <div><dt className="vc-kicker">Actions d’audit</dt><dd className="mt-1 tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {nf(data.audit.actions)}{data.audit.derniere ? <span className="text-xs" style={{ color: 'var(--text-muted)' }}> · dernière le {dateFr(data.audit.derniere)}</span> : null}</dd></div>
            <div><dt className="vc-kicker">Alertes / rapports</dt><dd className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              Non stockés en base : le rapport opérateur est recalculé à la demande depuis le dernier entraînement.</dd></div>
          </dl>
        </Section>
      </div>

      {/* ── Provenance ─────────────────────────────────────────────────── */}
      <details className="vc-card px-5 py-3 text-sm group">
        <summary className="cursor-pointer font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Database className="w-4 h-4" style={{ color: 'var(--accent-primary)' }} /> Provenance des chiffres (requêtes SQL)
        </summary>
        <dl className="mt-3 space-y-2">
          {Object.entries(data.sources).map(([k, q]) => (
            <div key={k} className="grid sm:grid-cols-[180px_1fr] gap-1">
              <dt className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{k.replace(/_/g, ' ')}</dt>
              <dd className="text-xs font-mono break-words" style={{ color: 'var(--text-muted)' }}>{q}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

function PageHeader({ loading, loadedAt, onRefresh }: { loading: boolean; loadedAt: Date | null; onRefresh: () => void }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>Vue d’ensemble</h1>
        <p className="text-sm mt-1 max-w-2xl" style={{ color: 'var(--text-secondary)' }}>
          Détection d’attaques de transmission (MITM, injection) sur les capteurs de la chaîne du froid.
          Tous les chiffres sont lus dans la base PostgreSQL à chaque chargement.
        </p>
      </div>
      <div className="flex items-center gap-3">
        {loadedAt && <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>Lu à {loadedAt.toLocaleTimeString('fr-FR')}</span>}
        <button onClick={onRefresh} disabled={loading}
          className="h-9 px-3 rounded-md border text-sm font-medium inline-flex items-center gap-2 disabled:opacity-60"
          style={{ borderColor: 'var(--border)', color: 'var(--text-primary)', background: 'var(--bg-card)' }}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Actualiser
        </button>
      </div>
    </div>
  );
}

function ScenarioBars({ rows }: { rows: Scenario[] }) {
  const present = rows.filter(r => r.lignes > 0);
  const absent = rows.filter(r => r.lignes === 0);
  return (
    <div data-testid="table-scenarios">
      <ul className="space-y-3">
        {present.map(r => {
          const tone = (r.taux ?? 0) >= 80 ? 'var(--accent-success)' : (r.taux ?? 0) >= 40 ? 'var(--accent-warning)' : 'var(--accent-danger)';
          const Icon = (r.taux ?? 0) >= 80 ? CheckCircle2 : (r.taux ?? 0) >= 40 ? MinusCircle : XCircle;
          return (
            <li key={r.scenario}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="inline-flex items-center gap-1.5 min-w-0" style={{ color: 'var(--text-primary)' }}>
                  <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: tone }} />
                  <span className="truncate">{SCENARIO_FR[r.scenario] ?? r.scenario}</span>
                </span>
                <span className="tabular-nums font-semibold shrink-0 whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{nf(r.taux, 1)} %</span>
              </div>
              <div className="mt-1.5"><Meter value={r.taux} color={tone} /></div>
              <div className="mt-1 text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {nf(r.detectees)} / {nf(r.lignes)} lignes · épisode{r.episodes > 1 ? 's' : ''} {nf(r.episodes_detectes)}/{nf(r.episodes)}
                {r.delai_median_min != null ? ` · détecté en ${nf(r.delai_median_min, 1)} min` : r.episodes ? ' · non détecté' : ''}
              </div>
            </li>
          );
        })}
      </ul>
      {absent.length > 0 && (
        <div className="mt-4 pt-3 text-xs" style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          Absents du bloc de test de cet entraînement (non mesurés ici) : {absent.map(r => SCENARIO_FR[r.scenario] ?? r.scenario).join(' · ')}.
        </div>
      )}
    </div>
  );
}
