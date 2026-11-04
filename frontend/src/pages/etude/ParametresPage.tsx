/** Paramètres (administrateur) — table app_settings via GET / PUT /api/v1/parametres. */
import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { authHeaders } from '../../lib/auth';
import { toast } from '@/components/ui/use-toast';
import { Empty, Loading, Note, PageHeader, Section, useApi } from '../../components/etude/kit';

interface Resp { valeurs: Record<string, number>; defauts: Record<string, number>; bornes: Record<string, [number, number]>; libelles: Record<string, string> }

export default function ParametresPage() {
  const { data, error, reload } = useApi<Resp>('/api/v1/parametres');
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setForm(Object.fromEntries(Object.entries(data.valeurs).map(([k, v]) => [k, String(v)]))); }, [data]);
  const header = <PageHeader title="Paramètres" subtitle="Réglages de la plateforme, modifiables par l'administrateur ; chaque modification est tracée dans le journal d'audit." />;
  if (!data) return <div className="space-y-4">{header}{error ? <Empty>{error}</Empty> : <Loading />}</div>;

  const save = async () => {
    setSaving(true);
    try {
      const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, Number(v.replace(',', '.'))]));
      const r = await fetch('/api/v1/parametres', { method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail ?? `HTTP ${r.status}`);
      toast({ title: 'Paramètres enregistrés' });
      reload();
    } catch (e) {
      toast({ title: 'Erreur', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-5">
      {header}
      <Section title="Détection et affichage" source="SELECT key, value, updated_at, updated_by FROM app_settings">
        <div className="space-y-4 max-w-xl">
          {Object.keys(data.valeurs).map(k => (
            <label key={k} className="block">
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{data.libelles[k] ?? k}</span>
              <input value={form[k] ?? ''} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} inputMode="decimal"
                className="mt-1 w-full rounded-md px-3 py-2 text-sm" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>entre {data.bornes[k][0]} et {data.bornes[k][1]} · défaut {data.defauts[k]}</span>
            </label>
          ))}
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-60"
            style={{ background: 'var(--accent-primary)', color: 'var(--accent-primary-fg)' }}><Save className="w-4 h-4" />Enregistrer</button>
        </div>
        <Note>La précision minimale et les fausses alertes tolérées s'appliquent au prochain entraînement lancé depuis le dashboard ; l'étude
          de référence (20 répétitions) garde le critère avec lequel elle a été calculée.</Note>
      </Section>
    </div>
  );
}
