import React, { useState, useEffect, useCallback } from "react";
import {
  ArrowLeftRight, ArrowRightLeft, Clock3, Users, CheckCircle2, XCircle,
  AlertTriangle, ChevronRight, X, Send, Eye, ShieldCheck, Ban, MessageSquare,
  Calendar, Filter, Search, RefreshCw, Crown, Sparkles, UserRoundX, BarChart3
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════
const STATUS_CONFIG = {
  PENDING: { color: "bg-amber-100 text-amber-700 border-amber-200", label: "Pending", icon: Clock3 },
  APPROVED: { color: "bg-emerald-100 text-emerald-700 border-emerald-200", label: "Approved", icon: CheckCircle2 },
  REJECTED: { color: "bg-rose-100 text-rose-700 border-rose-200", label: "Rejected", icon: XCircle },
  CANCELLED: { color: "bg-slate-100 text-slate-500 border-slate-200", label: "Cancelled", icon: Ban },
};

const SWAP_TYPES = {
  TRADE: { label: "Mutual Trade", description: "Both employees swap shifts", icon: ArrowLeftRight, color: "text-sky-600" },
  TAKE_OVER: { label: "Shift Take-Over", description: "Another employee takes your shift", icon: UserRoundX, color: "text-violet-600" },
};

// ═══════════════════════════════════════════════════════════════════
// REQUEST SWAP MODAL (Employee)
// ═══════════════════════════════════════════════════════════════════
function RequestSwapModal({ auth, shift, onClose, onSubmit }) {
  const [swapType, setSwapType] = useState("TRADE");
  const [targets, setTargets] = useState([]);
  const [selectedTarget, setSelectedTarget] = useState(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    setLoading(true);
    auth.fetchSwapTargets(shift.id).then(setTargets).catch(() => setTargets([])).finally(() => setLoading(false));
  }, [shift.id]);

  async function handleSubmit() {
    if (swapType === "TRADE" && !selectedTarget) {
      setToast({ msg: "Select a target shift to trade with", type: "error" });
      return;
    }
    setSubmitting(true);
    try {
      await auth.createShiftSwap({
        requesterShiftId: shift.id,
        targetUserId: selectedTarget?.user_id || null,
        targetShiftId: selectedTarget?.shift_id || null,
        swapType,
        reason: reason || null,
      });
      onSubmit();
    } catch (e) {
      setToast({ msg: e.message, type: "error" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content max-w-lg p-6 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {toast && <div className={`mb-4 px-4 py-2 rounded-xl text-sm flex items-center gap-2 ${toast.type === "error" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
          {toast.type === "error" ? <XCircle size={16}/> : <CheckCircle2 size={16}/>}{toast.msg}
        </div>}

        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-sky-400 to-blue-500 grid place-items-center text-white">
              <ArrowLeftRight size={20}/>
            </div>
            <div>
              <h2 className="text-xl font-semibold">Request Shift Swap</h2>
              <p className="text-xs text-slate-500">
                {new Date(shift.shift_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })} • {shift.shift_start?.slice(0, 5)} – {shift.shift_end?.slice(0, 5)}
              </p>
            </div>
          </div>
          <button className="h-8 w-8 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center" onClick={onClose}><X size={18}/></button>
        </div>

        {/* Your Shift Info */}
        <div className="bg-slate-50 dark:bg-navy-900 rounded-xl p-4 mb-4">
          <div className="text-xs text-slate-500 mb-1">Your Shift</div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">{shift.shift_start?.slice(0, 5)} – {shift.shift_end?.slice(0, 5)}</div>
              <div className="text-xs text-slate-500">{shift.department || "—"}</div>
            </div>
            <div className="text-xs px-2 py-1 rounded-full bg-sky-100 text-sky-700">Your shift</div>
          </div>
        </div>

        {/* Swap Type */}
        <div className="mb-4">
          <label className="text-sm font-medium mb-2 block">Swap Type</label>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(SWAP_TYPES).map(([key, config]) => {
              const Icon = config.icon;
              return (
                <button key={key} className={`p-3 rounded-xl border-2 text-left transition ${swapType === key ? "border-brand-400 bg-brand-50/50 dark:bg-brand-900/10" : "border-slate-100 dark:border-slate-700 hover:border-slate-200"}`}
                  onClick={() => { setSwapType(key); setSelectedTarget(null); }}>
                  <Icon size={18} className={config.color}/>
                  <div className="text-sm font-semibold mt-2">{config.label}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{config.description}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Target Selection (for TRADE) */}
        {swapType === "TRADE" && (
          <div className="mb-4">
            <label className="text-sm font-medium mb-2 block">Select Shift to Trade With</label>
            {loading ? (
              <div className="text-center py-6 text-slate-400 text-sm">Loading available shifts...</div>
            ) : targets.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-sm">
                <AlertTriangle size={20} className="mx-auto mb-2 opacity-50"/>
                No other shifts available on this date for trading.
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {targets.map(t => (
                  <button key={t.shift_id} className={`w-full p-3 rounded-xl border-2 text-left transition flex items-center justify-between ${selectedTarget?.shift_id === t.shift_id ? "border-brand-400 bg-brand-50/50" : "border-slate-100 dark:border-slate-700 hover:border-slate-200"}`}
                    onClick={() => setSelectedTarget(t)}>
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-brand-100 to-brand-200 text-brand-700 grid place-items-center text-xs font-bold">
                        {t.employee_name?.split(" ").map(n => n[0]).join("")}
                      </div>
                      <div>
                        <div className="text-sm font-medium">{t.employee_name}</div>
                        <div className="text-[10px] text-slate-500">{t.shift_start?.slice(0, 5)} – {t.shift_end?.slice(0, 5)} • {t.department || "—"}</div>
                      </div>
                    </div>
                    {selectedTarget?.shift_id === t.shift_id && <CheckCircle2 size={18} className="text-brand-500"/>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {swapType === "TAKE_OVER" && (
          <div className="mb-4 p-3 rounded-xl bg-violet-50 dark:bg-violet-900/10 border border-violet-200 dark:border-violet-800 text-xs text-violet-600">
            A manager will assign another employee to cover your shift. This request requires manager approval.
          </div>
        )}

        {/* Reason */}
        <div className="mb-5">
          <label className="text-sm font-medium mb-1 block">Reason (optional)</label>
          <textarea className="w-full h-20 px-4 border border-slate-200 dark:border-slate-600 rounded-xl text-sm bg-white dark:bg-navy-900 resize-none" value={reason} onChange={e => setReason(e.target.value)} placeholder="Why do you need this swap?"/>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button className="flex-1 h-12 rounded-2xl border border-slate-200 dark:border-slate-600 text-sm font-medium" onClick={onClose}>Cancel</button>
          <button className="flex-1 h-12 rounded-2xl bg-gradient-to-r from-sky-500 to-blue-600 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-sky-500/20" onClick={handleSubmit} disabled={submitting}>
            {submitting ? <><div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/> Submitting...</> : <><Send size={14}/> Submit Request</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SWAP DETAIL MODAL (Manager View)
// ═══════════════════════════════════════════════════════════════════
function SwapDetailModal({ auth, swap, onClose, onAction }) {
  const [notes, setNotes] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const isManager = (() => { try { const u = JSON.parse(localStorage.getItem("rhosam_user") || "{}"); return ["ADMIN", "MANAGER"].includes(u.role); } catch { return false; } })();
  const isPending = swap.status === "PENDING";

  async function handleApprove() {
    setActionLoading(true);
    try {
      await auth.approveShiftSwap(swap.id, { reviewerNotes: notes });
      onAction("approved");
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
    finally { setActionLoading(false); }
  }

  async function handleReject() {
    setActionLoading(true);
    try {
      await auth.rejectShiftSwap(swap.id, { reviewerNotes: notes });
      onAction("rejected");
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
    finally { setActionLoading(false); }
  }

  const StatusIcon = STATUS_CONFIG[swap.status]?.icon || Clock3;
  const swapTypeConfig = SWAP_TYPES[swap.swap_type] || SWAP_TYPES.TRADE;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content max-w-lg p-6 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {toast && <div className={`mb-4 px-4 py-2 rounded-xl text-sm flex items-center gap-2 ${toast.type === "error" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
          {toast.type === "error" ? <XCircle size={16}/> : <CheckCircle2 size={16}/>}{toast.msg}
        </div>}

        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-sky-400 to-blue-500 grid place-items-center text-white">
              <swapTypeConfig.icon size={20}/>
            </div>
            <div>
              <h2 className="text-xl font-semibold">Swap Request #{swap.id}</h2>
              <p className="text-xs text-slate-500">{swapTypeConfig.label} • {new Date(swap.created_at).toLocaleString()}</p>
            </div>
          </div>
          <div className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 ${STATUS_CONFIG[swap.status]?.color}`}>
            <StatusIcon size={14}/> {STATUS_CONFIG[swap.status]?.label}
          </div>
        </div>

        {/* Shifts Comparison */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          {/* Requester's Shift */}
          <div className="bg-sky-50 dark:bg-sky-900/10 rounded-xl p-4 border border-sky-200 dark:border-sky-800">
            <div className="text-[10px] text-sky-600 font-semibold mb-2">REQUESTER'S SHIFT</div>
            <div className="text-sm font-semibold">{swap.requester_name}</div>
            <div className="text-xs text-slate-500">{swap.requester_department || "—"}</div>
            <div className="mt-2 p-2 rounded-lg bg-white/80 dark:bg-navy-800/80">
              <div className="text-xs text-slate-500">Date</div>
              <div className="text-sm font-medium">{swap.requester_date?.slice(0, 10)}</div>
              <div className="text-xs text-slate-500 mt-1">Time</div>
              <div className="text-sm font-medium">{swap.requester_start?.slice(0, 5)} – {swap.requester_end?.slice(0, 5)}</div>
            </div>
          </div>

          {/* Target's Shift */}
          <div className={`rounded-xl p-4 border ${swap.target_shift_id ? "bg-violet-50 dark:bg-violet-900/10 border-violet-200 dark:border-violet-800" : "bg-slate-50 dark:bg-navy-900 border-slate-200 dark:border-slate-700"}`}>
            <div className={`text-[10px] font-semibold mb-2 ${swap.target_shift_id ? "text-violet-600" : "text-slate-400"}`}>
              {swap.swap_type === "TAKE_OVER" ? "COVERAGE NEEDED" : "TARGET SHIFT"}
            </div>
            {swap.target_name ? (
              <>
                <div className="text-sm font-semibold">{swap.target_name}</div>
                <div className="text-xs text-slate-500">{swap.target_department || "—"}</div>
                <div className="mt-2 p-2 rounded-lg bg-white/80 dark:bg-navy-800/80">
                  <div className="text-xs text-slate-500">Date</div>
                  <div className="text-sm font-medium">{swap.target_date?.slice(0, 10)}</div>
                  <div className="text-xs text-slate-500 mt-1">Time</div>
                  <div className="text-sm font-medium">{swap.target_start?.slice(0, 5)} – {swap.target_end?.slice(0, 5)}</div>
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-400 mt-2">Manager to assign coverage</div>
            )}
          </div>
        </div>

        {/* Arrow */}
        <div className="flex justify-center my-2">
          <ArrowLeftRight size={20} className="text-slate-300"/>
        </div>

        {/* Reason */}
        {swap.reason && (
          <div className="mb-4 p-3 rounded-xl bg-slate-50 dark:bg-navy-900 border border-slate-100 dark:border-slate-800">
            <div className="text-[10px] text-slate-500 mb-1">Reason</div>
            <div className="text-sm">{swap.reason}</div>
          </div>
        )}

        {/* Reviewer Notes */}
        {swap.reviewer_notes && (
          <div className="mb-4 p-3 rounded-xl bg-brand-50 dark:bg-brand-900/10 border border-brand-200 dark:border-brand-800">
            <div className="text-[10px] text-brand-600 mb-1">Reviewer Notes</div>
            <div className="text-sm">{swap.reviewer_notes}</div>
          </div>
        )}

        {/* Approval Actions */}
        {isManager && isPending && (
          <div className="space-y-3">
            <div>
              <label className="text-sm text-slate-500 mb-1 block">Notes (optional)</label>
              <textarea className="w-full h-16 px-4 border border-slate-200 dark:border-slate-600 rounded-xl text-sm bg-white dark:bg-navy-900 resize-none" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add review notes..."/>
            </div>
            <div className="flex gap-3">
              <button className="flex-1 h-12 rounded-2xl border-2 border-rose-200 text-rose-600 font-semibold text-sm flex items-center justify-center gap-2 hover:bg-rose-50 dark:hover:bg-rose-900/10 transition" onClick={handleReject} disabled={actionLoading}>
                {actionLoading ? <div className="h-4 w-4 border-2 border-rose-300 border-t-rose-600 rounded-full animate-spin"/> : <><XCircle size={16}/> Reject</>}
              </button>
              <button className="flex-1 h-12 rounded-2xl bg-gradient-to-r from-emerald-500 to-green-600 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20" onClick={handleApprove} disabled={actionLoading}>
                {actionLoading ? <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/> : <><CheckCircle2 size={16}/> Approve</>}
              </button>
            </div>
          </div>
        )}

        {!isManager && isPending && (
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 text-xs text-amber-600 flex items-center gap-2">
            <Clock3 size={14}/> Awaiting manager review
          </div>
        )}

        <button className="w-full h-11 rounded-xl border border-slate-200 dark:border-slate-600 text-sm font-medium mt-4" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN SHIFT SWAP PAGE
// ═══════════════════════════════════════════════════════════════════
export { RequestSwapModal };

// ═══════════════════════════════════════════════════════════════════
// SWAP ANALYTICS PANEL
// ═══════════════════════════════════════════════════════════════════
function SwapAnalyticsPanel({ auth }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(90);

  useEffect(() => {
    setLoading(true);
    auth.fetchShiftSwapAnalytics(period).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [period]);

  if (loading) return <div className="bg-white dark:bg-navy-800 rounded-2xl p-8 text-center text-slate-400"><div className="h-8 w-8 border-2 border-slate-300 border-t-brand-500 rounded-full animate-spin mx-auto mb-3"/> Loading analytics...</div>;
  if (!data?.ok) return <div className="bg-white dark:bg-navy-800 rounded-2xl p-8 text-center text-slate-400">No data available</div>;

  const { summary, topRequesters, topReviewers, daily, dayOfWeekPattern, hourPattern, topReasons, recentSwaps } = data;
  const maxDaily = Math.max(1, ...daily.map(d => d.total));
  const maxDow = Math.max(1, ...dayOfWeekPattern.map(d => d.count));
  const maxHour = Math.max(1, ...hourPattern.map(d => d.count));

  return (
    <div className="bg-white dark:bg-navy-800 rounded-2xl shadow-sm mb-6">
      <div className="p-5 border-b border-slate-100 dark:border-slate-700/50">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="font-semibold flex items-center gap-2"><BarChart3 size={18}/> Swap Analytics & Patterns</h3>
            <p className="text-xs text-slate-500 mt-1">Frequency, resolution times and behavioral patterns</p>
          </div>
          <div className="flex gap-1.5">
            {[30, 60, 90, 180].map(d => (
              <button key={d} onClick={() => setPeriod(d)} className={`px-3 py-1 rounded-lg text-xs font-medium transition ${period === d ? 'bg-brand-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200'}`}>{d}D</button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-5">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <div className="p-4 rounded-xl bg-gradient-to-br from-sky-500 to-sky-600 text-white">
            <div className="text-2xl font-bold">{summary.total}</div>
            <div className="text-xs opacity-80 mt-1">Total Swaps</div>
            <div className="text-xs opacity-60 mt-0.5">{summary.trades} trades · {summary.takeovers} take-overs</div>
          </div>
          <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white">
            <div className="text-2xl font-bold">{summary.approvalRate}%</div>
            <div className="text-xs opacity-80 mt-1">Approval Rate</div>
            <div className="text-xs opacity-60 mt-0.5">{summary.approved} approved · {summary.rejected} rejected</div>
          </div>
          <div className="p-4 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 text-white">
            <div className="text-2xl font-bold">{summary.avgResolutionHours}h</div>
            <div className="text-xs opacity-80 mt-1">Avg Resolution Time</div>
            <div className="text-xs opacity-60 mt-0.5">Time from request to decision</div>
          </div>
          <div className="p-4 rounded-xl bg-gradient-to-br from-violet-500 to-violet-600 text-white">
            <div className="text-2xl font-bold">{summary.pending}</div>
            <div className="text-xs opacity-80 mt-1">Pending Review</div>
            <div className="text-xs opacity-60 mt-0.5">Awaiting approval</div>
          </div>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Daily Trend */}
          <div>
            <h4 className="text-sm font-semibold mb-3">Daily Swap Requests</h4>
            <div className="flex items-end gap-1 h-32">
              {daily.slice(-14).map(d => (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full flex flex-col rounded-t" style={{ height: `${(d.total / maxDaily) * 100}%`, minHeight: 4 }}>
                    {d.approved > 0 && <div className="bg-emerald-400 rounded-t" style={{ height: `${(d.approved / d.total) * 100}%` }}/>}
                    {d.rejected > 0 && <div className="bg-rose-400" style={{ height: `${(d.rejected / d.total) * 100}%` }}/>}
                    {d.total - d.approved - d.rejected > 0 && <div className="bg-slate-300 dark:bg-slate-600 rounded-b" style={{ flex: 1 }}/>}
                  </div>
                  <span className="text-[9px] text-slate-400">{new Date(d.date).getDate()}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-3 text-[10px] text-slate-500 mt-2">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-emerald-400"/> Approved</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-rose-400"/> Rejected</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-slate-300"/> Pending</span>
            </div>
          </div>

          {/* Day of Week Pattern */}
          <div>
            <h4 className="text-sm font-semibold mb-3">Day-of-Week Pattern</h4>
            <div className="space-y-2">
              {dayOfWeekPattern.map(d => (
                <div key={d.day} className="flex items-center gap-2">
                  <span className="w-8 text-xs text-slate-500 text-right">{d.day}</span>
                  <div className="flex-1 h-5 rounded bg-slate-100 dark:bg-slate-700 overflow-hidden">
                    <div className="h-full rounded bg-gradient-to-r from-brand-400 to-brand-500 transition-all" style={{ width: `${(d.count / maxDow) * 100}%`, minWidth: d.count > 0 ? 8 : 0 }}/>
                  </div>
                  <span className="w-6 text-xs text-slate-500 text-right">{d.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Hour Pattern */}
        <div className="mb-6">
          <h4 className="text-sm font-semibold mb-3">Hour-of-Day Activity</h4>
          <div className="flex items-end gap-0.5 h-20">
            {hourPattern.map(h => (
              <div key={h.hour} className="flex-1 flex flex-col items-center">
                <div className="w-full rounded-t bg-brand-400 transition-all" style={{ height: `${(h.count / maxHour) * 100}%`, minHeight: h.count > 0 ? 2 : 0 }} title={`${h.hour}:00 — ${h.count} swaps`}/>
                {h.hour % 3 === 0 && <span className="text-[8px] text-slate-400 mt-0.5">{h.hour}h</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Two-Column: Top Requesters + Top Reasons */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div>
            <h4 className="text-sm font-semibold mb-3">Top Requesters</h4>
            <div className="space-y-2">
              {topRequesters.map((r, i) => (
                <div key={r.name} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <span className="text-xs text-slate-400 w-4">#{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{r.name}</div>
                    <div className="flex gap-2 text-[10px] text-slate-500">
                      <span>{r.total} requests</span>
                      <span className="text-emerald-600">{r.approved} approved</span>
                      {r.rejected > 0 && <span className="text-rose-600">{r.rejected} rejected</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-semibold">{r.total}</div>
                    <div className="text-[10px] text-slate-400">swaps</div>
                  </div>
                </div>
              ))}
              {!topRequesters.length && <div className="text-center py-4 text-slate-400 text-xs">No data</div>}
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-3">Common Reasons</h4>
            <div className="space-y-2">
              {topReasons.map((r, i) => (
                <div key={i} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <span className="text-xs text-slate-400 w-4">#{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{r.reason}</div>
                  </div>
                  <span className="text-xs font-semibold text-slate-500">×{r.count}</span>
                </div>
              ))}
              {!topReasons.length && <div className="text-center py-4 text-slate-400 text-xs">No reasons recorded</div>}
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div>
          <h4 className="text-sm font-semibold mb-3">Recent Activity</h4>
          <div className="space-y-1.5">
            {recentSwaps.map(s => {
              const cfg = STATUS_CONFIG[s.status] || STATUS_CONFIG.PENDING;
              const typeCfg = SWAP_TYPES[s.type] || SWAP_TYPES.TRADE;
              return (
                <div key={s.id} className="flex items-center gap-3 p-2 rounded-lg text-sm">
                  <typeCfg.icon size={14} className={typeCfg.color}/>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{s.requester}</span>
                    {s.target && <span className="text-slate-500"> → {s.target}</span>}
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${cfg.color}`}>{s.status}</span>
                  <span className="text-[10px] text-slate-400">{new Date(s.date).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}</span>
                </div>
              );
            })}
            {!recentSwaps.length && <div className="text-center py-4 text-slate-400 text-xs">No recent activity</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN SWAP PAGE
// ═══════════════════════════════════════════════════════════════════
export default function ShiftSwapPage({ auth }) {
  const [swaps, setSwaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("pending");
  const [statusFilter, setStatusFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showRequestModal, setShowRequestModal] = useState(null); // shift object or null
  const [showDetail, setShowDetail] = useState(null);
  const [toast, setToast] = useState(null);
  const [showAnalytics, setShowAnalytics] = useState(false);

  const isManager = (() => { try { const u = JSON.parse(localStorage.getItem("rhosam_user") || "{}"); return ["ADMIN", "MANAGER"].includes(u.role); } catch { return false; } })();

  const loadSwaps = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      const data = await auth.fetchShiftSwaps(params);
      setSwaps(data);
    } catch {} finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { loadSwaps(); }, [loadSwaps]);

  // Filter by search
  const filteredSwaps = swaps.filter(s => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (s.requester_name?.toLowerCase().includes(q) ||
            s.target_name?.toLowerCase().includes(q) ||
            s.reason?.toLowerCase().includes(q) ||
            String(s.id).includes(q));
  });

  // Group by status for tabs
  const pendingSwaps = filteredSwaps.filter(s => s.status === "PENDING");
  const approvedSwaps = filteredSwaps.filter(s => s.status === "APPROVED");
  const rejectedSwaps = filteredSwaps.filter(s => s.status === "REJECTED");
  const allSwaps = filteredSwaps;

  const displayedSwaps = activeTab === "pending" ? pendingSwaps : activeTab === "approved" ? approvedSwaps : activeTab === "rejected" ? rejectedSwaps : allSwaps;

  function handleSwapAction(action) {
    setShowDetail(null);
    setToast({ msg: action === "approved" ? "Swap approved and executed!" : "Swap rejected.", type: action === "approved" ? "success" : "info" });
    loadSwaps();
  }

  return (
    <div>
      {/* Toast */}
      {toast && <div className={`fixed top-4 left-4 right-4 z-50 max-w-md mx-auto ${toast.type === "error" ? "bg-rose-500" : toast.type === "info" ? "bg-sky-500" : "bg-emerald-500"} text-white px-4 py-3 rounded-2xl shadow-xl text-sm font-medium flex items-center gap-2 animate-slide-down`}>
        {toast.type === "error" ? <XCircle size={16}/> : <CheckCircle2 size={16}/>}{toast.msg}
        <button className="ml-auto opacity-70 hover:opacity-100" onClick={() => setToast(null)}><X size={16}/></button>
      </div>}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ArrowLeftRight size={24}/> Shift Swaps & Trades
          </h1>
          <p className="text-slate-500 text-sm mt-1">Request shift trades and manage swap approvals</p>
        </div>
        <div className="flex gap-2">
          {isManager && (
            <button className={`btn-sm px-3 py-1.5 rounded-xl text-sm font-medium transition ${showAnalytics ? 'bg-brand-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200'}`} onClick={() => setShowAnalytics(!showAnalytics)}>
              <BarChart3 size={14} className="inline mr-1"/> Analytics
            </button>
          )}
          <button className="btn-secondary btn-sm" onClick={loadSwaps}><RefreshCw size={14}/> Refresh</button>
        </div>
      </div>

      {/* Analytics Panel */}
      {showAnalytics && isManager && <SwapAnalyticsPanel auth={auth} />}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: "Pending", count: pendingSwaps.length, color: "bg-amber-50 text-amber-700 border-amber-200", icon: Clock3 },
          { label: "Approved", count: approvedSwaps.length, color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
          { label: "Rejected", count: rejectedSwaps.length, color: "bg-rose-50 text-rose-700 border-rose-200", icon: XCircle },
          { label: "Total", count: allSwaps.length, color: "bg-slate-50 text-slate-700 border-slate-200", icon: Eye },
        ].map(s => (
          <div key={s.label} className={`rounded-xl p-3 border ${s.color} flex items-center gap-3`}>
            <s.icon size={18}/>
            <div><div className="text-xl font-bold">{s.count}</div><div className="text-[10px] opacity-70">{s.label}</div></div>
          </div>
        ))}
      </div>

      {/* Tabs + Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
        <div className="flex gap-2">
          {[["pending", "Pending", Clock3], ["approved", "Approved", CheckCircle2], ["rejected", "Rejected", XCircle], ["all", "All", Eye]].map(([key, label, Icon]) => (
            <button key={key} className={`px-4 py-2 rounded-xl text-sm font-medium transition flex items-center gap-1.5 ${activeTab === key ? "bg-navy-900 text-white dark:bg-brand-400 dark:text-navy-950" : "bg-white dark:bg-navy-800 text-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-100 dark:border-slate-700"}`}
              onClick={() => setActiveTab(key)}>
              <Icon size={14}/> {label}
              {key === "pending" && pendingSwaps.length > 0 && <span className="ml-1 h-5 w-5 rounded-full bg-amber-400 text-navy-950 text-[10px] font-bold grid place-items-center">{pendingSwaps.length}</span>}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16}/>
          <input className="input pl-9 h-9 w-64 text-sm" placeholder="Search by name, reason..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}/>
        </div>
      </div>

      {/* Swap List */}
      <div className="space-y-3">
        {loading ? (
          <div className="text-center py-12 text-slate-400"><div className="h-10 w-10 rounded-full bg-slate-100 grid place-items-center mx-auto mb-3 animate-pulse"><ArrowLeftRight size={20}/></div>Loading swaps...</div>
        ) : displayedSwaps.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <ArrowLeftRight size={40} className="mx-auto mb-3 opacity-30"/>
            <p className="font-medium">No swap requests found</p>
            <p className="text-xs mt-1">Swap requests appear here when employees request shift trades.</p>
          </div>
        ) : (
          displayedSwaps.map(swap => {
            const StatusIcon = STATUS_CONFIG[swap.status]?.icon || Clock3;
            const swapTypeConfig = SWAP_TYPES[swap.swap_type] || SWAP_TYPES.TRADE;
            return (
              <div key={swap.id} className="bg-white dark:bg-navy-800 rounded-2xl p-5 shadow-sm border border-slate-100 dark:border-slate-700 hover:shadow-md transition cursor-pointer" onClick={() => setShowDetail(swap)}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-sky-100 to-blue-200 dark:from-sky-900/30 dark:to-blue-900/30 grid place-items-center">
                      <swapTypeConfig.icon size={18} className={swapTypeConfig.color}/>
                    </div>
                    <div>
                      <div className="text-sm font-semibold">#{swap.id} — {swapTypeConfig.label}</div>
                      <div className="text-[10px] text-slate-500">{new Date(swap.created_at).toLocaleString()}</div>
                    </div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-semibold flex items-center gap-1 ${STATUS_CONFIG[swap.status]?.color}`}>
                    <StatusIcon size={10}/> {STATUS_CONFIG[swap.status]?.label}
                  </span>
                </div>

                {/* Shifts Row */}
                <div className="flex items-center gap-3">
                  {/* Requester */}
                  <div className="flex-1 p-3 rounded-xl bg-sky-50 dark:bg-sky-900/10">
                    <div className="text-[10px] text-sky-600 font-semibold">REQUESTER</div>
                    <div className="text-sm font-medium mt-1">{swap.requester_name}</div>
                    <div className="text-xs text-slate-500">{swap.requester_start?.slice(0, 5)} – {swap.requester_end?.slice(0, 5)} • {swap.requester_date?.slice(5, 10)}</div>
                  </div>

                  <ArrowLeftRight size={16} className="text-slate-300 shrink-0"/>

                  {/* Target */}
                  <div className={`flex-1 p-3 rounded-xl ${swap.target_name ? "bg-violet-50 dark:bg-violet-900/10" : "bg-slate-50 dark:bg-navy-900"}`}>
                    <div className={`text-[10px] font-semibold ${swap.target_name ? "text-violet-600" : "text-slate-400"}`}>
                      {swap.swap_type === "TAKE_OVER" ? "NEEDS COVER" : "TARGET"}
                    </div>
                    {swap.target_name ? (
                      <>
                        <div className="text-sm font-medium mt-1">{swap.target_name}</div>
                        <div className="text-xs text-slate-500">{swap.target_start?.slice(0, 5)} – {swap.target_end?.slice(0, 5)} • {swap.target_date?.slice(5, 10)}</div>
                      </>
                    ) : <div className="text-xs text-slate-400 mt-1">Manager to assign</div>}
                  </div>
                </div>

                {/* Reason */}
                {swap.reason && (
                  <div className="mt-3 p-2 rounded-lg bg-slate-50 dark:bg-navy-900 text-xs text-slate-500 flex items-center gap-2">
                    <MessageSquare size={12}/>{swap.reason}
                  </div>
                )}

                {/* Reviewer */}
                {swap.reviewer_name && (
                  <div className="mt-2 text-[10px] text-slate-400">
                    Reviewed by {swap.reviewer_name} {swap.reviewer_notes && `• "${swap.reviewer_notes}"`}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Modals */}
      {showRequestModal && <RequestSwapModal auth={auth} shift={showRequestModal} onClose={() => setShowRequestModal(null)} onSubmit={() => { setShowRequestModal(null); setToast({ msg: "Swap request submitted!", type: "success" }); loadSwaps(); }}/>}
      {showDetail && <SwapDetailModal auth={auth} swap={showDetail} onClose={() => setShowDetail(null)} onAction={handleSwapAction}/>}
    </div>
  );
}
