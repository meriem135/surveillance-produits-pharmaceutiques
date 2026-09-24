import { useEffect, useRef, useState } from 'react';
import type { LivePoint, LiveDpiStats, LiveAlertEvent } from '../types';

const HISTORY_LIMIT = 80;
const ALERTS_LIMIT = 40;
const RECONNECT_DELAY = 2500;

export function useLiveStream({ enabled = true }: { enabled?: boolean } = {}) {
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [point, setPoint] = useState<LivePoint | null>(null);
  const [alerts, setAlerts] = useState<LiveAlertEvent[]>([]);
  const [stats, setStats] = useState<LiveDpiStats | null>(null);
  const [history, setHistory] = useState<LivePoint[]>([]);
  const [counters, setCounters] = useState({ attacks: 0, normal: 0, total: 0 });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const countersRef = useRef({ attacks: 0, normal: 0, total: 0 });

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let ws: WebSocket | null = null;

    const scheduleReconnect = () => {
      if (disposed) return;
      if (reconnectTimer.current !== null) window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = window.setTimeout(connect, RECONNECT_DELAY);
    };

    const connect = () => {
      if (disposed) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      try {
        ws = new WebSocket(`${proto}://${location.host}/ws/stream`);
      } catch {
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) return;
        setConnected(true);
        setPaused(false);
      };

      ws.onmessage = (ev) => {
        if (disposed) return;
        try {
          const data = JSON.parse(ev.data) as LivePoint;
          if (data.type === 'paused') {
            setPaused(true);
            return;
          }
          if (data.type === 'reset') {
            countersRef.current = { attacks: 0, normal: 0, total: 0 };
            setCounters({ ...countersRef.current });
            return;
          }
          setPaused(false);
          setPoint(data);
          setHistory(prev => [...prev.slice(-(HISTORY_LIMIT - 1)), data]);
          countersRef.current.total += 1;
          if (data.is_anomaly || data.attack_active) countersRef.current.attacks += 1;
          else countersRef.current.normal += 1;
          setCounters({ ...countersRef.current });
          if (data.dpi_stats) setStats(data.dpi_stats);
          if (data.dpi_alert?.rule) {
            const rule = data.dpi_alert.rule;
            const alert: LiveAlertEvent = {
              timestamp: data.timestamp || new Date().toISOString(),
              rule_id: rule.id || 'DPI-000',
              rule_name: rule.name || 'Alerte DPI',
              severity: rule.level || 8,
              description: rule.description || '',
              attack_type: data.attack_info?.type || rule.name || '',
              attack_explanation: data.attack_info?.explanation || '',
              risk_score: data.risk_score || 0,
              season: data.season,
              recommendation: data.recommendation,
            };
            setAlerts(prev => [alert, ...prev].slice(0, ALERTS_LIMIT));
          }
        } catch { /* message invalide ignoré */ }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (!disposed) scheduleReconnect();
      };
      ws.onerror = () => ws?.close();
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer.current !== null) window.clearTimeout(reconnectTimer.current);
      if (ws) { ws.onclose = null; ws.close(); }
      wsRef.current = null;
    };
  }, [enabled]);

  return { connected, paused, point, alerts, stats, history, counters };
}