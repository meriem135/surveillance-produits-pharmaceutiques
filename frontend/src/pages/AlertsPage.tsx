import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Search, AlertTriangle, Info, Eye } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import type { Alert } from '../types';

const LEVEL_META: Record<number, { label: string; color: string; badge: 'success' | 'warning' | 'destructive' }> = {
  3:  { label: 'Low',      color: '#22C55E', badge: 'success' },
  5:  { label: 'Medium',   color: '#F97316', badge: 'warning' },
  7:  { label: 'High',     color: '#EF4444', badge: 'destructive' },
  10: { label: 'Critical', color: '#dc2626', badge: 'destructive' },
  14: { label: 'Extreme',  color: '#991b1b', badge: 'destructive' },
};

const MOCK_ALERTS: Alert[] = Array.from({ length: 50 }, (_, i) => ({
  id: i + 1,
  rule_id: ['1001', '1002', '2001', '3001', '4001'][Math.floor(Math.random() * 5)],
  level: [3, 5, 7, 10, 14][Math.floor(Math.random() * 5)],
  description: ['Scan réseau détecté', 'Tentative brute force', 'Trafic anormal', 'Falsification Modbus', 'Ransomware détecté'][Math.floor(Math.random() * 5)],
  device: [`PLC_${Math.floor(Math.random() * 3) + 1}`, `Capteur_${Math.floor(Math.random() * 4) + 1}`, `Routeur_${Math.floor(Math.random() * 2) + 1}`][Math.floor(Math.random() * 3)],
  timestamp: new Date(Date.now() - Math.random() * 86400000).toISOString().replace('T', ' ').slice(0, 19),
}));

const severityData = Object.entries(LEVEL_META).map(([level, meta]) => ({
  name: meta.label, value: MOCK_ALERTS.filter((a) => a.level === Number(level)).length, color: meta.color,
})).filter(d => d.value > 0);

const ruleData = Object.entries(MOCK_ALERTS.reduce((acc, a) => { (acc[a.rule_id] ??= []).push(a); return acc; }, {} as Record<string, Alert[]>))
  .map(([rule, alerts]) => ({ rule, count: alerts.length }));

export default function AlertsPage() {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('all');

  const filtered = useMemo(() => {
    let a = MOCK_ALERTS;
    if (search.trim()) {
      const q = search.toLowerCase();
      a = a.filter((al) => al.description.toLowerCase().includes(q) || al.device.toLowerCase().includes(q));
    }
    if (activeTab === 'critical') a = a.filter(al => al.level >= 10);
    else if (activeTab === 'high') a = a.filter(al => al.level >= 7 && al.level < 10);
    else if (activeTab === 'medium') a = a.filter(al => al.level >= 5 && al.level < 7);
    else if (activeTab === 'low') a = a.filter(al => al.level < 5);
    return a.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }, [search, activeTab]);

  const criticalCount = MOCK_ALERTS.filter((a) => a.level >= 10).length;
  const totalCount = MOCK_ALERTS.length;

  const handleMarkAsRead = useCallback((alert: Alert) => {
    toast({
      title: 'Alerte marquée',
      description: `${alert.description} — ${alert.device}`,
      variant: alert.level >= 10 ? 'destructive' : 'default',
    });
  }, []);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase tracking-wider opacity-60">Alertes Totales</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-display text-3xl font-bold" style={{ color: 'var(--accent-primary)' }}>{totalCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase tracking-wider opacity-60">Critiques</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-display text-3xl font-bold" style={{ color: 'var(--accent-danger)' }}>{criticalCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs uppercase tracking-wider opacity-60">Sécurité</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-display text-3xl font-bold" style={{ color: 'var(--accent-success)' }}>
              {Math.round((1 - criticalCount / totalCount) * 100)}%
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Distribution par Sévérité</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={severityData} dataKey="value" cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={3}>
                    {severityData.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                  </Pie>
                  <RechartsTooltip
                    contentStyle={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 13 }}
                    labelStyle={{ color: 'var(--text-secondary)' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center gap-4 mt-2 flex-wrap">
              {severityData.map((s) => (
                <Badge key={s.name} variant="outline" className="gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                  {s.name} ({s.value})
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Alertes par Règle</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ruleData}>
                  <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                  <XAxis dataKey="rule" stroke="var(--text-secondary)" tick={{ fontSize: 11 }} />
                  <YAxis stroke="var(--text-secondary)" tick={{ fontSize: 11 }} />
                  <RechartsTooltip contentStyle={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 12 }} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {ruleData.map((_, idx) => (
                      <Cell key={idx} fill={idx % 2 === 0 ? 'var(--accent-primary)' : 'var(--accent-success)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table with Tabs */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle>Journal des Alertes</CardTitle>
          <div className="flex items-center gap-3">
            <div className="relative w-56">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} />
              <Input
                placeholder="Rechercher..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9 text-xs"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="all" value={activeTab} onValueChange={setActiveTab} className="mb-4">
            <TabsList>
              <TabsTrigger value="all">Toutes</TabsTrigger>
              <TabsTrigger value="critical">Critiques</TabsTrigger>
              <TabsTrigger value="high">Élevées</TabsTrigger>
              <TabsTrigger value="medium">Moyennes</TabsTrigger>
              <TabsTrigger value="low">Faibles</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="sticky top-0 z-10" style={{ background: 'var(--bg-sidebar)' }}>
                  {['Timestamp', 'Appareil', 'Règle', 'Sévérité', 'Description', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-3 font-semibold border-b" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((alert, i) => (
                  <motion.tr
                    key={alert.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.01 }}
                    className="hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="font-mono text-[11px] px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>{alert.timestamp}</td>
                    <td className="px-4 py-3 border-b font-medium" style={{ borderColor: 'var(--border)' }}>{alert.device}</td>
                    <td className="font-mono text-[11px] px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>{alert.rule_id}</td>
                    <td className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                      <Badge variant={LEVEL_META[alert.level].badge}>{LEVEL_META[alert.level].label}</Badge>
                    </td>
                    <td className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>{alert.description}</td>
                    <td className="px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                      <div className="flex items-center gap-2">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="w-7 h-7">
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle className="flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4" style={{ color: LEVEL_META[alert.level].color }} />
                                Alerte #{alert.id}
                              </DialogTitle>
                              <DialogDescription>
                                Détails complets de l'alerte
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-3 text-sm">
                              <div className="flex justify-between"><span className="opacity-60">Appareil</span><span className="font-medium">{alert.device}</span></div>
                              <div className="flex justify-between"><span className="opacity-60">Règle</span><span className="font-mono text-xs">{alert.rule_id}</span></div>
                              <div className="flex justify-between"><span className="opacity-60">Sévérité</span><Badge variant={LEVEL_META[alert.level].badge}>{LEVEL_META[alert.level].label}</Badge></div>
                              <div className="flex justify-between"><span className="opacity-60">Timestamp</span><span className="font-mono text-xs">{alert.timestamp}</span></div>
                              <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                                <span className="opacity-60 block mb-1">Description</span>
                                <p>{alert.description}</p>
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
                        <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => handleMarkAsRead(alert)}>
                          <Info className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
