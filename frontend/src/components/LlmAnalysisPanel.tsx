import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, X, Send, Loader2, FileText } from 'lucide-react';
import type { AttackType } from '../types';

interface LlmAnalysisPanelProps {
  activeAttack: AttackType | null;
  normalityScore: number;
  anomalyCount: number;
}

interface LlmResponse {
  report: string;
  engine: string;
  model: string;
  rag_docs_used: number;
  ollama_available: boolean;
}

const ATTACK_LABELS: Record<string, string> = {
  recon: 'Reconnaissance',
  mitm: 'Man-in-the-Middle',
  ddos: 'IoT_DDoS',
  ransom: 'Ransomware',
};



function markdownToHtml(md: string): string {
  return md
    .replace(/^### (.*$)/gm, '<strong style="color:var(--accent-primary);font-size:13px;display:block;margin-top:8px">$1</strong>')
    .replace(/^## (.*$)/gm, '<strong style="color:var(--accent-warning);font-size:14px;display:block;margin-top:10px">$1</strong>')
    .replace(/^# (.*$)/gm, '<strong style="color:var(--accent-danger);font-size:15px;display:block;margin-top:12px">$1</strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--text-primary)">$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code style="background:var(--border);padding:1px 4px;border-radius:3px;font-size:11px">$1</code>')
    .replace(/\n/g, '<br>');
}

export default function LlmAnalysisPanel({ activeAttack, normalityScore }: LlmAnalysisPanelProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LlmResponse | null>(null);
  const [error, setError] = useState('');
  const [question, setQuestion] = useState('');

  async function runAnalysis() {
    setLoading(true);
    setError('');
    setResult(null);

    const attackType = activeAttack ? ATTACK_LABELS[activeAttack] : 'IoT_DDoS';
    const severity = normalityScore < 40 ? 'CRITICAL' : normalityScore < 60 ? 'HIGH' : normalityScore < 80 ? 'MEDIUM' : 'LOW';
    const riskScore = Math.round(100 - normalityScore);

    const payload = {
      device_id: 'dev-fridge-01',
      rule_id: 'DPI-001',
      rule_name: 'Alerte comportementale',
      rule_description: activeAttack ? `Attaque ${attackType} detectee` : 'Surveillance normale',
      attack_type: attackType,
      risk_score: riskScore,
      severity,
      sensor: 'fridge',
      force_template: false,
      question: question || null,
    };

    try {
      const resp = await fetch('/api/v1/analyst/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error(`Erreur ${resp.status}`);
      const data: LlmResponse = await resp.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion');
    } finally {
      setLoading(false);
    }
  }

  function getSeverityColor(): string {
    if (normalityScore < 40) return 'var(--accent-danger)';
    if (normalityScore < 60) return 'oklch(0.75 0.18 60)';
    if (normalityScore < 80) return 'var(--accent-warning)';
    return 'var(--accent-success)';
  }

  return (
    <>
      <motion.button
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold border cursor-pointer transition-all"
        style={{
          background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent-purple) 15%, transparent), color-mix(in srgb, var(--accent-primary) 15%, transparent))',
          borderColor: 'color-mix(in srgb, var(--accent-purple) 40%, transparent)',
          color: 'var(--accent-purple)',
        }}
      >
        <Brain className="h-3.5 w-3.5" />
        Analyse LLM
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
            onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 20, opacity: 0 }}
              className="rounded-2xl border w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col"
              style={{ background: 'var(--bg-panel)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center justify-between p-5 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{
                    background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent-purple) 20%, transparent), color-mix(in srgb, var(--accent-primary) 20%, transparent))',
                  }}>
                    <Brain className="h-4 w-4" style={{ color: 'var(--accent-purple)' }} />
                  </div>
                  <div>
                    <h2 className="font-display font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                      Analyse LLM · SOC Analyst IA
                    </h2>
                    <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                      Moteur RAG + {activeAttack ? 'Alerte active' : 'Surveillance normale'}
                    </div>
                  </div>
                </div>
                <button onClick={() => setOpen(false)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center border cursor-pointer"
                  style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="p-5 space-y-4 overflow-y-auto flex-1">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                    <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>Score normalité</div>
                    <div className="text-lg font-bold font-mono" style={{ color: getSeverityColor() }}>{normalityScore.toFixed(1)}%</div>
                  </div>
                  <div className="p-3 rounded-xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                    <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>Type d'attaque</div>
                    <div className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                      {activeAttack ? ATTACK_LABELS[activeAttack] : 'Aucune'}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-mono block mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Question pour l'IA (optionnelle)
                  </label>
                  <input
                    type="text"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Ex: Quels sont les risques pour la ligne de production ?"
                    className="w-full px-3 py-2 rounded-xl text-xs border outline-none"
                    style={{
                      background: 'var(--bg-card)',
                      borderColor: 'var(--border)',
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>

                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.99 }}
                  onClick={runAnalysis}
                  disabled={loading}
                  className="w-full py-3 rounded-xl text-xs font-bold border cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{
                    background: 'linear-gradient(135deg, var(--accent-purple), var(--accent-primary))',
                    borderColor: 'transparent',
                    color: '#fff',
                  }}
                >
                  {loading ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyse en cours...</>
                  ) : (
                    <><Send className="h-3.5 w-3.5" /> Lancer l'analyse LLM</>
                  )}
                </motion.button>

                {error && (
                  <div className="p-3 rounded-xl text-xs" style={{
                    background: 'color-mix(in srgb, var(--accent-danger) 10%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--accent-danger) 30%, transparent)',
                    color: 'var(--accent-danger)',
                  }}>
                    ❌ {error}
                  </div>
                )}

                {result && (
                  <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                    <div className="flex items-center gap-3 p-3 text-xs border-b" style={{
                      background: 'var(--bg-card)',
                      borderColor: 'var(--border)',
                      color: 'var(--text-secondary)',
                    }}>
                      <FileText className="h-3.5 w-3.5" />
                      <span>Moteur: <strong style={{ color: 'var(--text-primary)' }}>{result.engine}</strong></span>
                      <span className="opacity-50">|</span>
                      <span>Modèle: <strong style={{ color: 'var(--text-primary)' }}>{result.model}</strong></span>
                      <span className="opacity-50">|</span>
                      <span>{result.rag_docs_used} documents RAG</span>
                      {result.ollama_available && (
                        <span className="ml-auto px-2 py-0.5 rounded text-[9px]" style={{
                          background: 'color-mix(in srgb, var(--accent-success) 15%, transparent)',
                          color: 'var(--accent-success)',
                        }}>
                          Ollama ✓
                        </span>
                      )}
                    </div>
                    <div
                      className="p-4 text-xs leading-relaxed max-h-80 overflow-y-auto"
                      style={{ color: 'var(--text-secondary)', lineHeight: '1.7' }}
                      dangerouslySetInnerHTML={{ __html: markdownToHtml(result.report) }}
                    />
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
