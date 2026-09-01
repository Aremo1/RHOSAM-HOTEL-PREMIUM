/**
 * StatusMonitor — Real-time backend health monitor.
 *
 * Shows a small status badge in the header and expands into a full
 * status panel on click. Polls /api/health every 30 seconds.
 *
 * Usage:
 *   <StatusMonitor />
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Activity, CheckCircle2, AlertTriangle, XCircle, RefreshCw,
  Wifi, WifiOff, Clock3, Database, Server, ChevronDown, ChevronUp,
  MemoryStick, Zap
} from "lucide-react";

const POLL_INTERVAL = 30000; // 30 seconds

export default function StatusMonitor() {
  const [health, setHealth] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [polling, setPolling] = useState(true);
  const [lastPoll, setLastPoll] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const timerRef = useRef(null);

  const fetchHealth = useCallback(async () => {
    try {
      const r = await fetch("/api/health");
      const t = await r.text();
      if (!t) { setHealth({ status: "error", message: "Empty response" }); return; }
      try {
        const data = JSON.parse(t);
        setHealth(data);
        setLastPoll(new Date());
      } catch {
        setHealth({ status: "error", message: "Invalid JSON from server" });
      }
    } catch (err) {
      setHealth({ status: "error", message: err.message || "Network error" });
    }
  }, []);

  // Online/offline detection
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => { setIsOnline(false); setExpanded(true); };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => { window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); };
  }, []);

  // Polling
  useEffect(() => {
    fetchHealth();
    if (polling) {
      timerRef.current = setInterval(fetchHealth, POLL_INTERVAL);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [polling, fetchHealth]);

  const statusColor = {
    ok: "bg-emerald-500",
    degraded: "bg-amber-500",
    error: "bg-rose-500",
  };

  const statusIcon = {
    ok: <CheckCircle2 size={10} className="text-white" />,
    degraded: <AlertTriangle size={10} className="text-white" />,
    error: <XCircle size={10} className="text-white" />,
  };

  const dotColor = {
    ok: "bg-emerald-400 shadow-emerald-400/50",
    degraded: "bg-amber-400 shadow-amber-400/50",
    error: "bg-rose-400 shadow-rose-400/50",
  };

  const status = !isOnline ? "error" : (health?.status || "error");

  return (
    <div className="relative">
      {/* Status Badge — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium transition-all duration-200 hover:bg-slate-100 dark:hover:bg-slate-800"
        title={`Server: ${status === "ok" ? "Healthy" : status === "degraded" ? "Degraded" : "Down"}`}
      >
        <span className={`w-2 h-2 rounded-full shadow-lg ${dotColor[status]} ${status === "ok" ? "animate-pulse" : ""}`} />
        <span className="text-slate-600 dark:text-slate-400 hidden sm:inline">
          {!isOnline ? "Offline" : status === "ok" ? "Healthy" : status === "degraded" ? "Degraded" : "Down"}
        </span>
        {expanded ? <ChevronUp size={12} className="text-slate-400" /> : <ChevronDown size={12} className="text-slate-400" />}
      </button>

      {/* Expanded Panel */}
      {expanded && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setExpanded(false)} />

          {/* Panel */}
          <div className="absolute right-0 top-full mt-2 z-50 w-80 bg-white dark:bg-navy-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-slide-down">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <Activity size={16} className="text-brand-500" />
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">System Status</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => fetchHealth()}
                  className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  title="Refresh"
                >
                  <RefreshCw size={12} className="text-slate-400" />
                </button>
                <button
                  onClick={() => setExpanded(false)}
                  className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                >
                  <XCircle size={12} className="text-slate-400" />
                </button>
              </div>
            </div>

            {/* Status Banner */}
            <div className={`px-4 py-3 flex items-center gap-3 ${status === "ok" ? "bg-emerald-50 dark:bg-emerald-900/20" : status === "degraded" ? "bg-amber-50 dark:bg-amber-900/20" : "bg-rose-50 dark:bg-rose-900/20"}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${statusColor[status]}`}>
                {statusIcon[status]}
              </div>
              <div>
                <div className={`text-sm font-semibold ${status === "ok" ? "text-emerald-700 dark:text-emerald-300" : status === "degraded" ? "text-amber-700 dark:text-amber-300" : "text-rose-700 dark:text-rose-300"}`}>
                  {!isOnline ? "You Are Offline" : status === "ok" ? "All Systems Operational" : status === "degraded" ? "Partial Degradation" : "Service Unavailable"}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {lastPoll ? `Last checked ${lastPoll.toLocaleTimeString()}` : "Checking..."}
                </div>
              </div>
            </div>

            {/* Check Details */}
            {health?.checks && (
              <div className="px-4 py-3 space-y-2.5 max-h-64 overflow-y-auto">
                {/* Database */}
                <StatusRow
                  icon={<Database size={14} />}
                  label="Database"
                  value={health.checks.database?.status === "ok" ? `Connected (${health.checks.database.latencyMs}ms)` : health.checks.database?.error || "Disconnected"}
                  ok={health.checks.database?.status === "ok"}
                />

                {/* Connection Pool */}
                {health.checks.pool && (
                  <StatusRow
                    icon={<Server size={14} />}
                    label="Connection Pool"
                    value={`${health.checks.pool.total}/${health.checks.pool.max} active, ${health.checks.pool.idle} idle`}
                    ok={health.checks.pool.waiting === 0}
                  />
                )}

                {/* Memory */}
                {health.checks.memory && (
                  <StatusRow
                    icon={<Zap size={14} />}
                    label="Memory"
                    value={`${health.checks.memory.heapUsedMB}MB / ${health.checks.memory.heapTotalMB}MB heap`}
                    ok={health.checks.memory.heapUsedMB < health.checks.memory.heapTotalMB * 0.85}
                  />
                )}

                {/* WebSocket */}
                {health.checks.websocket && (
                  <StatusRow
                    icon={<Wifi size={14} />}
                    label="WebSocket"
                    value={`${health.checks.websocket.connectedClients} clients`}
                    ok={true}
                  />
                )}

                {/* Uptime */}
                {health.checks.uptime && (
                  <StatusRow
                    icon={<Clock3 size={14} />}
                    label="Uptime"
                    value={health.checks.uptime.formatted}
                    ok={true}
                  />
                )}

                {/* Environment */}
                {health.checks.environment && (
                  <StatusRow
                    icon={<Activity size={14} />}
                    label="Environment"
                    value={health.checks.environment}
                    ok={health.checks.environment !== "production" || status === "ok"}
                  />
                )}
              </div>
            )}

            {/* Error message */}
            {health?.message && (
              <div className="px-4 py-2 bg-rose-50 dark:bg-rose-900/20 border-t border-rose-200 dark:border-rose-800">
                <div className="text-xs text-rose-600 dark:text-rose-400">{health.message}</div>
              </div>
            )}

            {/* Footer */}
            <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <span className="text-[10px] text-slate-400">
                v{health?.version || "?"}
              </span>
              <button
                onClick={() => setPolling(!polling)}
                className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${polling ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400" : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"}`}
              >
                Auto-refresh: {polling ? "ON" : "OFF"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatusRow({ icon, label, value, ok }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${ok ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400" : "bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400"}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-slate-700 dark:text-slate-300">{label}</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{value}</div>
      </div>
    </div>
  );
}
