import React, { useState, useEffect, useCallback, useRef } from "react";
import { RequestSwapModal } from "./ShiftSwapPage";
import {
  Calendar, Clock3, Users, Plus, ChevronLeft, ChevronRight, GripVertical,
  Trash2, Copy, Zap, AlertTriangle, CheckCircle2, XCircle, Filter,
  Download, RefreshCw, Crown, X, Search, Sparkles, Brain, TrendingUp, ArrowLeftRight,
  BarChart3, Settings, Star, Target, ShieldCheck, Lightbulb, CircleDollarSign
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════
const SHIFT_TEMPLATES = [
  { name: "Morning", start: "06:00", end: "14:00", color: "bg-amber-100 text-amber-700 border-amber-200", dotColor: "bg-amber-400" },
  { name: "Afternoon", start: "14:00", end: "22:00", color: "bg-sky-100 text-sky-700 border-sky-200", dotColor: "bg-sky-400" },
  { name: "Night", start: "22:00", end: "06:00", color: "bg-violet-100 text-violet-700 border-violet-200", dotColor: "bg-violet-400" },
  { name: "Full Day", start: "08:00", end: "18:00", color: "bg-emerald-100 text-emerald-700 border-emerald-200", dotColor: "bg-emerald-400" },
  { name: "Split", start: "08:00", end: "12:00", color: "bg-rose-100 text-rose-700 border-rose-200", dotColor: "bg-rose-400" },
];

const DEPT_COLORS = {
  "Front Office": "bg-sky-500",
  "Housekeeping": "bg-emerald-500",
  "Food & Beverage": "bg-brand-500",
  "Engineering": "bg-amber-500",
  "Management": "bg-violet-500",
  "Security": "bg-rose-500",
  "Spa": "bg-pink-500",
  "Unassigned": "bg-slate-400",
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getDeptColor(dept) { return DEPT_COLORS[dept] || "bg-slate-400"; }
function getShiftTemplate(start, end) {
  return SHIFT_TEMPLATES.find(t => t.start === start && t.end === end) || SHIFT_TEMPLATES[3];
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: Get week dates
// ═══════════════════════════════════════════════════════════════════
function getWeekDates(baseDate) {
  const d = new Date(baseDate);
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const dd = new Date(monday);
    dd.setDate(monday.getDate() + i);
    dates.push(dd);
  }
  return dates;
}

function formatDate(d) { return d.toISOString().slice(0, 10); }
function formatDayName(d) { return d.toLocaleDateString("en-US", { weekday: "short" }); }
function formatDayNum(d) { return d.getDate(); }
function formatMonth(d) { return d.toLocaleDateString("en-US", { month: "long" }); }
function isToday(d) { const t = new Date(); return d.toDateString() === t.toDateString(); }

// ═══════════════════════════════════════════════════════════════════
// SHIFT CARD (draggable)
// ═══════════════════════════════════════════════════════════════════
function ShiftCard({ shift, onEdit, onDelete, onDragStart, onSwap, hasConflict, conflictSeverity }) {
  const tmpl = getShiftTemplate(shift.shift_start, shift.shift_end);
  const conflictBorder = hasConflict ? (conflictSeverity === "CRITICAL" ? "ring-2 ring-rose-400/60" : "ring-2 ring-amber-400/60") : "";
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/json", JSON.stringify({ type: "shift", shiftId: shift.id }));
        e.dataTransfer.effectAllowed = "move";
        onDragStart?.(shift);
      }}
      className={`group relative ${tmpl.color} border rounded-xl p-2.5 cursor-grab active:cursor-grabbing transition hover:shadow-md mb-1.5 ${conflictBorder}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-1.5">
          <GripVertical size={12} className="opacity-40 shrink-0"/>
          {hasConflict && <div className={`h-2 w-2 rounded-full shrink-0 ${conflictSeverity === "CRITICAL" ? "bg-rose-500 animate-pulse" : "bg-amber-400"}`} title={conflictSeverity === "CRITICAL" ? "Critical conflict" : "Warning"}/>}
          <div className="min-w-0">
            <div className="text-xs font-semibold truncate">{shift.employee_name}</div>
            <div className="text-[10px] opacity-70 flex items-center gap-1">
              <Clock3 size={9}/>{shift.shift_start?.slice(0, 5)} – {shift.shift_end?.slice(0, 5)}
            </div>
          </div>
        </div>
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition shrink-0">
          <button className="h-5 w-5 rounded flex items-center justify-center hover:bg-white/50" title="Edit" onClick={(e) => { e.stopPropagation(); onEdit(shift); }}><Copy size={10}/></button>
          {onSwap && <button className="h-5 w-5 rounded flex items-center justify-center hover:bg-sky-100" title="Request Swap" onClick={(e) => { e.stopPropagation(); onSwap(shift); }}><ArrowLeftRight size={10}/></button>}
          <button className="h-5 w-5 rounded flex items-center justify-center hover:bg-red-100" onClick={(e) => { e.stopPropagation(); onDelete(shift.id); }}><Trash2 size={10}/></button>
        </div>
      </div>
      {shift.notes && <div className="text-[10px] opacity-60 mt-1 truncate">{shift.notes}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EMPLOYEE SIDEBAR (draggable)
// ═══════════════════════════════════════════════════════════════════
function EmployeeCard({ employee }) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/json", JSON.stringify({ type: "employee", userId: employee.id, name: employee.name, department: employee.department }));
        e.dataTransfer.effectAllowed = "copy";
      }}
      className="flex items-center gap-2.5 p-2 rounded-xl bg-white dark:bg-navy-800 border border-slate-100 dark:border-slate-700 cursor-grab active:cursor-grabbing hover:shadow-md transition group"
    >
      <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-brand-100 to-brand-200 text-brand-700 grid place-items-center text-xs font-bold shrink-0">
        {employee.name?.split(" ").map(n => n[0]).join("")}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium truncate">{employee.name}</div>
        <div className="text-[10px] text-slate-500 truncate">{employee.department || "—"}</div>
      </div>
      <GripVertical size={12} className="text-slate-300 opacity-0 group-hover:opacity-100 transition shrink-0"/>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DEMAND FORECAST PANEL
// ═══════════════════════════════════════════════════════════════════
function DemandForecastPanel({ forecast, onClose }) {
  if (!forecast) return null;
  const { forecast: days, totalRooms } = forecast;

  const avgOccupancy = days.reduce((s, d) => s + d.estimatedOccupancy, 0) / days.length;
  const totalGap = days.reduce((s, d) => s + Math.max(0, d.gap), 0);
  const fullyStaffedDays = days.filter(d => d.status === "fully_staffed").length;

  return (
    <div className="space-y-5">
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gradient-to-br from-sky-50 to-sky-100 dark:from-sky-900/20 dark:to-sky-800/20 rounded-2xl p-4 text-center">
          <TrendingUp size={20} className="text-sky-500 mx-auto mb-1"/>
          <div className="text-2xl font-bold text-sky-700 dark:text-sky-400">{Math.round(avgOccupancy)}%</div>
          <div className="text-[10px] text-sky-500">Avg Occupancy</div>
        </div>
        <div className="bg-gradient-to-br from-violet-50 to-violet-100 dark:from-violet-900/20 dark:to-violet-800/20 rounded-2xl p-4 text-center">
          <Brain size={20} className="text-violet-500 mx-auto mb-1"/>
          <div className="text-2xl font-bold text-violet-700 dark:text-violet-400">{totalRooms}</div>
          <div className="text-[10px] text-violet-500">Total Rooms</div>
        </div>
        <div className={`bg-gradient-to-br rounded-2xl p-4 text-center ${totalGap > 0 ? "from-rose-50 to-rose-100 dark:from-rose-900/20 dark:to-rose-800/20" : "from-emerald-50 to-emerald-100 dark:from-emerald-900/20 dark:to-emerald-800/20"}`}>
          <Target size={20} className={`mx-auto mb-1 ${totalGap > 0 ? "text-rose-500" : "text-emerald-500"}`}/>
          <div className={`text-2xl font-bold ${totalGap > 0 ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>{totalGap > 0 ? `-${totalGap}` : "✓"}</div>
          <div className={`text-[10px] ${totalGap > 0 ? "text-rose-500" : "text-emerald-500"}`}>{totalGap > 0 ? "Staff Gap" : "Fully Staffed"}</div>
        </div>
      </div>

      {/* Daily Forecast */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold flex items-center gap-2"><BarChart3 size={14}/> Daily Forecast</h4>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {days.map(d => {
            const statusColor = d.status === "fully_staffed" ? "text-emerald-600 bg-emerald-50" : d.status === "adequate" ? "text-amber-600 bg-amber-50" : "text-rose-600 bg-rose-50";
            const barWidth = Math.min(100, (d.currentStaffScheduled / Math.max(d.totalStaffNeeded, 1)) * 100);
            return (
              <div key={d.date} className="bg-white dark:bg-navy-800 rounded-xl p-3 border border-slate-100 dark:border-slate-700">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold">{d.dayName}</span>
                    <span className="text-xs text-slate-400">{d.date.slice(5)}</span>
                    {d.isWeekend && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-600">Weekend</span>}
                  </div>
                  <span className={`text-[10px] px-2 py-1 rounded-full font-medium ${statusColor}`}>
                    {d.status === "fully_staffed" ? "✓ Staffed" : d.status === "adequate" ? "⚠ Adequate" : "✕ Understaffed"}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500 mb-2">
                  <span>Occ: {d.estimatedOccupancy}%</span>
                  <span>•</span>
                  <span>Need: {d.totalStaffNeeded}</span>
                  <span>•</span>
                  <span>Scheduled: {d.currentStaffScheduled}</span>
                  {d.gap > 0 && <><span>•</span><span className="text-rose-500 font-semibold">Gap: {d.gap}</span></>}
                </div>
                <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${barWidth}%`, background: barWidth >= 100 ? "#10b981" : barWidth >= 80 ? "#f59e0b" : "#ef4444" }}/>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {Object.entries(d.departmentNeeds).map(([dept, need]) => (
                    <span key={dept} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 dark:bg-slate-800 text-slate-500">
                      {dept.split(" ")[0]}: {need}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EMPLOYEE PREFERENCES PANEL
// ═══════════════════════════════════════════════════════════════════
function PreferencesPanel({ employees, preferences, onSave, onClose }) {
  const [edits, setEdits] = useState({});

  function getPref(userId) {
    const existing = preferences.find(p => p.user_id === userId);
    return edits[userId] || {
      preferred_shift: existing?.preferred_shift || "Morning",
      preferred_days: existing?.preferred_days ? (typeof existing.preferred_days === "string" ? JSON.parse(existing.preferred_days) : existing.preferred_days) : [1,2,3,4,5],
      max_hours_weekly: existing?.max_hours_weekly || 40,
      notes: existing?.notes || "",
    };
  }

  function updatePref(userId, field, value) {
    setEdits(prev => ({ ...prev, [userId]: { ...getPref(userId), [field]: value } }));
  }

  async function handleSaveAll() {
    const allPrefs = employees.map(emp => ({
      userId: emp.id,
      preferredShift: getPref(emp.id).preferred_shift,
      preferredDays: getPref(emp.id).preferred_days,
      maxHoursWeekly: getPref(emp.id).max_hours_weekly,
      notes: getPref(emp.id).notes,
    }));
    await onSave(allPrefs);
  }

  const hasChanges = Object.keys(edits).length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Configure shift preferences for each employee. The AI scheduler will respect these when generating schedules.</p>
      </div>

      <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
        {employees.map(emp => {
          const pref = getPref(emp.id);
          return (
            <div key={emp.id} className="bg-white dark:bg-navy-800 rounded-xl p-4 border border-slate-100 dark:border-slate-700">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-brand-100 to-brand-200 text-brand-700 grid place-items-center text-xs font-bold">
                  {emp.name?.split(" ").map(n => n[0]).join("")}
                </div>
                <div>
                  <div className="text-sm font-semibold">{emp.name}</div>
                  <div className="text-[10px] text-slate-500">{emp.department || "—"}</div>
                </div>
              </div>

              {/* Preferred Shift */}
              <div className="mb-2">
                <label className="text-[10px] text-slate-500 mb-1 block">Preferred Shift</label>
                <div className="flex flex-wrap gap-1">
                  {SHIFT_TEMPLATES.map(t => (
                    <button key={t.name} type="button" className={`px-2 py-1 rounded-lg text-[10px] font-medium border transition ${pref.preferred_shift === t.name ? t.color + " border-current" : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-500 hover:bg-slate-100"}`}
                      onClick={() => updatePref(emp.id, "preferred_shift", t.name)}>
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preferred Days */}
              <div className="mb-2">
                <label className="text-[10px] text-slate-500 mb-1 block">Preferred Work Days</label>
                <div className="flex gap-1">
                  {DAY_NAMES.map((name, i) => (
                    <button key={i} type="button" className={`h-7 w-7 rounded-lg text-[10px] font-medium transition ${pref.preferred_days.includes(i) ? "bg-brand-400 text-navy-950" : "bg-slate-100 dark:bg-slate-700 text-slate-400 hover:bg-slate-200"}`}
                      onClick={() => {
                        const days = pref.preferred_days.includes(i) ? pref.preferred_days.filter(d => d !== i) : [...pref.preferred_days, i].sort();
                        updatePref(emp.id, "preferred_days", days);
                      }}>
                      {name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Max Hours */}
              <div>
                <label className="text-[10px] text-slate-500 mb-1 block">Max Hours/Week: <span className="font-semibold text-slate-700">{pref.max_hours_weekly}h</span></label>
                <input type="range" min="20" max="60" step="4" value={pref.max_hours_weekly}
                  onChange={e => updatePref(emp.id, "max_hours_weekly", Number(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none bg-slate-200 dark:bg-slate-700 accent-brand-500"/>
              </div>
            </div>
          );
        })}
      </div>

      <button className="w-full h-11 rounded-xl bg-gradient-to-r from-brand-400 to-brand-500 text-navy-950 font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-brand-400/20"
        onClick={handleSaveAll} disabled={!hasChanges}>
        <Settings size={14}/> Save All Preferences
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// AI AUTO-SCHEDULE RESULTS MODAL
// ═══════════════════════════════════════════════════════════════════
function AutoScheduleResults({ result, onClose }) {
  if (!result) return null;
  return (
    <div className="space-y-4">
      {/* Success Header */}
      <div className="text-center py-4">
        <div className="h-16 w-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 grid place-items-center mx-auto mb-3">
          <Sparkles size={28} className="text-emerald-500"/>
        </div>
        <h3 className="text-lg font-semibold">Schedule Generated!</h3>
        <p className="text-sm text-slate-500 mt-1">AI has optimized the schedule based on demand and preferences.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-3 text-center">
          <div className="text-xl font-bold text-emerald-600">{result.created}</div>
          <div className="text-[10px] text-emerald-500">Shifts Created</div>
        </div>
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 text-center">
          <div className="text-xl font-bold text-amber-600">{result.skipped}</div>
          <div className="text-[10px] text-amber-500">Skipped</div>
        </div>
        <div className={`rounded-xl p-3 text-center ${result.warnings.length > 0 ? "bg-rose-50 dark:bg-rose-900/20" : "bg-sky-50 dark:bg-sky-900/20"}`}>
          <div className={`text-xl font-bold ${result.warnings.length > 0 ? "text-rose-600" : "text-sky-600"}`}>{result.warnings.length}</div>
          <div className={`text-[10px] ${result.warnings.length > 0 ? "text-rose-500" : "text-sky-500"}`}>Warnings</div>
        </div>
      </div>

      {/* Summary by Date */}
      <div>
        <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><Calendar size={14}/> Schedule Summary</h4>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {result.summary.map(s => (
            <div key={s.date} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-navy-900 rounded-xl">
              <div>
                <div className="text-sm font-medium">{new Date(s.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</div>
                <div className="text-[10px] text-slate-500">{s.departments.join(", ")}</div>
              </div>
              <div className="text-sm font-bold">{s.count} shifts</div>
            </div>
          ))}
        </div>
      </div>

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/10 rounded-xl p-4 border border-amber-200 dark:border-amber-800">
          <h4 className="text-sm font-semibold text-amber-700 mb-2 flex items-center gap-2"><AlertTriangle size={14}/> Warnings</h4>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {result.warnings.map((w, i) => <div key={i} className="text-xs text-amber-600">• {w}</div>)}
          </div>
        </div>
      )}

      <button className="w-full h-11 rounded-xl bg-navy-900 dark:bg-brand-400 text-white dark:text-navy-950 font-semibold text-sm" onClick={onClose}>Done</button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CONFLICT ALERTS PANEL
// ═══════════════════════════════════════════════════════════════════
function ConflictAlertsPanel({ conflicts, summary, loading, onRefresh, onClose }) {
  const [filter, setFilter] = useState("all");
  const [expandType, setExpandType] = useState(null);

  const filtered = (conflicts || []).filter(c => {
    if (filter === "all") return true;
    if (filter === "critical") return c.severity === "CRITICAL";
    if (filter === "warning") return c.severity === "WARNING";
    return c.type === filter;
  });

  const groupedByType = {};
  filtered.forEach(c => {
    if (!groupedByType[c.type]) groupedByType[c.type] = [];
    groupedByType[c.type].push(c);
  });

  const TYPE_CONFIG = {
    OVERLAP: { label: "Overlapping Shifts", icon: ArrowLeftRight, color: "text-rose-600", bg: "bg-rose-50 dark:bg-rose-900/10", desc: "Same employee has two shifts at the same time" },
    MAX_HOURS: { label: "Max Hours Exceeded", icon: Clock3, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-900/10", desc: "Employee exceeds weekly hour limit" },
    UNDERSTAFFED: { label: "Understaffed", icon: Users, color: "text-orange-600", bg: "bg-orange-50 dark:bg-orange-900/10", desc: "Department below minimum staffing level" },
    UNASSIGNED: { label: "Unassigned Shifts", icon: AlertTriangle, color: "text-violet-600", bg: "bg-violet-50 dark:bg-violet-900/10", desc: "Shifts without a department" },
    NO_SHIFTS: { label: "No Shifts Scheduled", icon: XCircle, color: "text-rose-700", bg: "bg-rose-50 dark:bg-rose-900/10", desc: "Entire day has no staff coverage" },
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-rose-50 dark:bg-rose-900/10 rounded-xl p-3 text-center border border-rose-200 dark:border-rose-800">
          <div className="text-2xl font-bold text-rose-600">{summary?.critical || 0}</div>
          <div className="text-[10px] text-rose-500">Critical</div>
        </div>
        <div className="bg-amber-50 dark:bg-amber-900/10 rounded-xl p-3 text-center border border-amber-200 dark:border-amber-800">
          <div className="text-2xl font-bold text-amber-600">{summary?.warnings || 0}</div>
          <div className="text-[10px] text-amber-500">Warnings</div>
        </div>
        <div className="bg-slate-50 dark:bg-navy-900 rounded-xl p-3 text-center border border-slate-200 dark:border-slate-700">
          <div className="text-2xl font-bold text-slate-600">{summary?.total || 0}</div>
          <div className="text-[10px] text-slate-500">Total Issues</div>
        </div>
      </div>

      {/* Filter Buttons */}
      <div className="flex flex-wrap gap-1.5">
        {["all", "critical", "warning"].map(f => (
          <button key={f} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${filter === f ? "bg-navy-900 text-white dark:bg-brand-400 dark:text-navy-950" : "bg-slate-100 dark:bg-slate-800 text-slate-600 hover:bg-slate-200"}`} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "critical" ? "🔴 Critical" : "🟡 Warnings"}
          </button>
        ))}
        {Object.keys(TYPE_CONFIG).map(type => {
          const count = summary?.byType?.[type] || 0;
          if (!count) return null;
          return (
            <button key={type} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${filter === type ? "bg-navy-900 text-white dark:bg-brand-400 dark:text-navy-950" : "bg-slate-100 dark:bg-slate-800 text-slate-600 hover:bg-slate-200"}`} onClick={() => setFilter(type)}>
              {TYPE_CONFIG[type]?.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Issues List */}
      <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
        {loading ? (
          <div className="text-center py-8 text-slate-400 text-sm">Scanning for conflicts...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8">
            <CheckCircle2 size={40} className="mx-auto mb-3 text-emerald-400"/>
            <div className="font-medium text-emerald-600">No conflicts found!</div>
            <div className="text-xs text-slate-500 mt-1">Schedule looks good for this week.</div>
          </div>
        ) : (
          Object.entries(groupedByType).map(([type, items]) => {
            const config = TYPE_CONFIG[type] || { label: type, icon: AlertTriangle, color: "text-slate-600", bg: "bg-slate-50" };
            const Icon = config.icon;
            const isExpanded = expandType === type;
            return (
              <div key={type} className="rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
                <button className="w-full p-3 flex items-center justify-between bg-white dark:bg-navy-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition" onClick={() => setExpandType(isExpanded ? null : type)}>
                  <div className="flex items-center gap-3">
                    <div className={`h-8 w-8 rounded-lg grid place-items-center ${config.bg}`}><Icon size={16} className={config.color}/></div>
                    <div className="text-left">
                      <div className="text-sm font-semibold">{config.label}</div>
                      <div className="text-[10px] text-slate-500">{config.desc}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700">{items.length}</span>
                    <ChevronRight size={14} className={`text-slate-400 transition ${isExpanded ? "rotate-90" : ""}`}/>
                  </div>
                </button>
                {isExpanded && (
                  <div className="border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-navy-900/50">
                    {items.map((c, i) => (
                      <div key={i} className="px-4 py-2.5 flex items-start gap-3 border-b border-slate-50 dark:border-slate-800 last:border-0">
                        <div className={`h-1.5 w-1.5 rounded-full mt-1.5 shrink-0 ${c.severity === "CRITICAL" ? "bg-rose-500" : "bg-amber-400"}`}/>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium">{c.message}</div>
                          <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
                            {c.date && <span>{c.date}</span>}
                            {c.department && <span>• {c.department}</span>}
                            {c.employee && <span>• {c.employee}</span>}
                            {c.hours && <span>• {c.hours}h / {c.maxHours}h</span>}
                            {c.gap && <span className="text-rose-500">• {c.gap} short</span>}
                          </div>
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${c.severity === "CRITICAL" ? "bg-rose-100 text-rose-600" : "bg-amber-100 text-amber-600"}`}>{c.severity}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// LABOR COST OPTIMIZATION PANEL
// ═══════════════════════════════════════════════════════════════════
function CostOptimizationPanel({ costData, loading }) {
  const [expandDept, setExpandDept] = useState(null);
  const [expandSuggestion, setExpandSuggestion] = useState(null);

  if (loading) return <div className="text-center py-12"><div className="h-10 w-10 rounded-full bg-emerald-100 grid place-items-center mx-auto mb-3 animate-pulse"><CircleDollarSign size={20} className="text-emerald-500"/></div><p className="text-sm text-slate-500">Analyzing labor costs...</p></div>;
  if (!costData) return null;

  const { summary, byDepartment, suggestions } = costData;
  const totalSavings = suggestions.reduce((s, sg) => s + (sg.potentialSavings || 0), 0);

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gradient-to-br from-emerald-50 to-green-50 dark:from-emerald-900/10 dark:to-green-900/10 rounded-2xl p-4 border border-emerald-200 dark:border-emerald-800">
          <div className="text-[10px] text-emerald-600 font-semibold">TOTAL LABOR COST</div>
          <div className="text-2xl font-bold text-emerald-700 mt-1">₦{Number(summary.grandTotal).toLocaleString()}</div>
          <div className="text-[10px] text-emerald-500 mt-0.5">{summary.totalShifts} shifts • {summary.totalHours}h</div>
        </div>
        <div className={`bg-gradient-to-br rounded-2xl p-4 border ${totalSavings > 0 ? "from-amber-50 to-orange-50 dark:from-amber-900/10 dark:to-orange-900/10 border-amber-200 dark:border-amber-800" : "from-slate-50 to-slate-100 dark:from-navy-900 dark:to-slate-800 border-slate-200 dark:border-slate-700"}`}>
          <div className="text-[10px] text-slate-600 font-semibold">POTENTIAL SAVINGS</div>
          <div className={`text-2xl font-bold mt-1 ${totalSavings > 0 ? "text-amber-600" : "text-emerald-600"}`}>{totalSavings > 0 ? `₦${Number(totalSavings).toLocaleString()}` : "✓ Optimized"}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">{suggestions.length} suggestions</div>
        </div>
      </div>

      {/* Cost Breakdown */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white dark:bg-navy-800 rounded-xl p-3 text-center border border-slate-100 dark:border-slate-700">
          <div className="text-[10px] text-slate-500">Regular Pay</div>
          <div className="text-sm font-bold text-slate-700">₦{Number(summary.totalRegular).toLocaleString()}</div>
          <div className="text-[10px] text-slate-400">{Math.round(summary.totalRegular / Math.max(summary.grandTotal, 1) * 100)}%</div>
        </div>
        <div className="bg-white dark:bg-navy-800 rounded-xl p-3 text-center border border-slate-100 dark:border-slate-700">
          <div className="text-[10px] text-slate-500">Overtime Pay</div>
          <div className="text-sm font-bold text-rose-600">₦{Number(summary.totalOvertime).toLocaleString()}</div>
          <div className="text-[10px] text-slate-400">{Math.round(summary.totalOvertime / Math.max(summary.grandTotal, 1) * 100)}%</div>
        </div>
        <div className="bg-white dark:bg-navy-800 rounded-xl p-3 text-center border border-slate-100 dark:border-slate-700">
          <div className="text-[10px] text-slate-500">Premium Pay</div>
          <div className="text-sm font-bold text-amber-600">₦{Number(summary.totalPremium).toLocaleString()}</div>
          <div className="text-[10px] text-slate-400">{Math.round(summary.totalPremium / Math.max(summary.grandTotal, 1) * 100)}%</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white dark:bg-navy-800 rounded-xl p-3 text-center border border-slate-100 dark:border-slate-700">
          <div className="text-[10px] text-slate-500">Avg Cost/Shift</div>
          <div className="text-sm font-bold">₦{Number(summary.avgCostPerShift).toLocaleString()}</div>
        </div>
        <div className="bg-white dark:bg-navy-800 rounded-xl p-3 text-center border border-slate-100 dark:border-slate-700">
          <div className="text-[10px] text-slate-500">Avg Cost/Hour</div>
          <div className="text-sm font-bold">₦{Number(summary.avgCostPerHour).toLocaleString()}</div>
        </div>
      </div>

      {/* Optimization Suggestions */}
      {suggestions.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-3 flex items-center gap-2"><Sparkles size={14} className="text-amber-500"/> Optimization Suggestions</h4>
          <div className="space-y-2">
            {suggestions.map((sg, i) => {
              const sevColor = { HIGH: "bg-rose-100 text-rose-700 border-rose-200", MEDIUM: "bg-amber-100 text-amber-700 border-amber-200", LOW: "bg-sky-100 text-sky-700 border-sky-200" };
              const isExpanded = expandSuggestion === i;
              return (
                <div key={i} className="rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
                  <button className="w-full p-3 flex items-center justify-between bg-white dark:bg-navy-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition" onClick={() => setExpandSuggestion(isExpanded ? null : i)}>
                    <div className="flex items-center gap-3">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${sevColor[sg.severity]}`}>{sg.severity}</span>
                      <div className="text-left">
                        <div className="text-sm font-semibold">{sg.title}</div>
                        <div className="text-[10px] text-slate-500">{sg.type.replace(/_/g, " ")}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {sg.potentialSavings > 0 && <span className="text-xs font-bold text-emerald-600">Save ₦{sg.potentialSavings.toLocaleString()}</span>}
                      <ChevronRight size={14} className={`text-slate-400 transition ${isExpanded ? "rotate-90" : ""}`}/>
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="p-3 bg-slate-50 dark:bg-navy-900/50 border-t border-slate-100 dark:border-slate-700">
                      <p className="text-xs text-slate-600 dark:text-slate-400">{sg.description}</p>
                      {sg.employee && <div className="text-[10px] text-slate-400 mt-2">Employee: {sg.employee} • Dept: {sg.department}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Department Breakdown */}
      <div>
        <h4 className="text-sm font-semibold mb-3 flex items-center gap-2"><BarChart3 size={14}/> Department Breakdown</h4>
        <div className="space-y-2">
          {Object.entries(byDepartment).map(([dept, data]) => {
            const isExpanded = expandDept === dept;
            const deptPct = Math.round(data.totalCost / Math.max(summary.grandTotal, 1) * 100);
            return (
              <div key={dept} className="rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
                <button className="w-full p-3 flex items-center justify-between bg-white dark:bg-navy-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition" onClick={() => setExpandDept(isExpanded ? null : dept)}>
                  <div className="flex items-center gap-3">
                    <div className={`h-2 w-2 rounded-full ${getDeptColor(dept)}`}/>
                    <div className="text-left"><div className="text-sm font-semibold">{dept}</div><div className="text-[10px] text-slate-500">{data.shiftCount} shifts • {Math.round(data.totalHours)}h</div></div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold">₦{Number(data.totalCost).toLocaleString()}</span>
                    <span className="text-[10px] text-slate-400">{deptPct}%</span>
                    <ChevronRight size={14} className={`text-slate-400 transition ${isExpanded ? "rotate-90" : ""}`}/>
                  </div>
                </button>
                {isExpanded && (
                  <div className="p-3 bg-slate-50 dark:bg-navy-900/50 border-t border-slate-100 dark:border-slate-700">
                    <div className="grid grid-cols-3 gap-2 mb-3 text-[10px]">
                      <div className="text-slate-500">Regular: <span className="font-semibold">₦{Number(data.regularCost).toLocaleString()}</span></div>
                      <div className="text-slate-500">Overtime: <span className="font-semibold text-rose-600">₦{Number(data.overtimeCost).toLocaleString()}</span></div>
                      <div className="text-slate-500">Premium: <span className="font-semibold text-amber-600">₦{Number(data.totalCost - data.regularCost).toLocaleString()}</span></div>
                    </div>
                    <div className="space-y-1.5">
                      {Object.entries(data.employees).map(([name, empData]) => (
                        <div key={name} className="flex items-center justify-between text-xs">
                          <span className="text-slate-600">{name}</span>
                          <span className="font-semibold">{empData.hours.toFixed(1)}h — ₦{Number(empData.cost).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN SCHEDULING PAGE
// ═══════════════════════════════════════════════════════════════════
export default function SchedulingPage({ auth }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [shifts, setShifts] = useState([]);
  const [employees, setEmployees] = useState({});
  const [loading, setLoading] = useState(true);
  const [deptFilter, setDeptFilter] = useState("");
  const [showAddModal, setShowAddModal] = useState(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [toast, setToast] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [dragSource, setDragSource] = useState(null);

  // AI Auto-Schedule state
  const [showAIModal, setShowAIModal] = useState(null); // "forecast" | "preferences" | "auto" | "results"
  const [forecast, setForecast] = useState(null);
  const [preferences, setPreferences] = useState([]);
  const [autoResult, setAutoResult] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [clearExisting, setClearExisting] = useState(false);
  const [showSwapModal, setShowSwapModal] = useState(null); // shift object for swap request
  const [conflicts, setConflicts] = useState({ conflicts: [], summary: { total: 0, critical: 0, warnings: 0, byType: {} } });
  const [conflictLoading, setConflictLoading] = useState(false);
  const [showConflictPanel, setShowConflictPanel] = useState(false);
  const [showCostPanel, setShowCostPanel] = useState(false);
  const [costData, setCostData] = useState(null);
  const [costLoading, setCostLoading] = useState(false);

  const weekDates = getWeekDates(currentDate);
  const from = formatDate(weekDates[0]);
  const to = formatDate(weekDates[6]);

  // Fetch conflicts for current week
  const loadConflicts = useCallback(async () => {
    setConflictLoading(true);
    try {
      const data = await auth.fetchShiftConflicts({ from, to });
      setConflicts(data);
    } catch {} finally { setConflictLoading(false); }
  }, [from, to]);  useEffect(() => { loadConflicts(); }, [loadConflicts]);

  const loadCostAnalysis = useCallback(async () => {
    setCostLoading(true);
    try {
      const data = await auth.fetchCostAnalysis({ from, to });
      setCostData(data);
    } catch {} finally { setCostLoading(false); }
  }, [from, to]);

  // Conflict counts per date
  const conflictsByDate = {};
  (conflicts.conflicts || []).forEach(c => {
    if (c.date) {
      if (!conflictsByDate[c.date]) conflictsByDate[c.date] = [];
      conflictsByDate[c.date].push(c);
    }
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, e] = await Promise.all([
        auth.fetchShifts({ from, to }),
        auth.fetchShiftEmployees()
      ]);
      setShifts(s); setEmployees(e);
    } catch {} finally { setLoading(false); loadConflicts(); }
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  // Group shifts by date
  const shiftsByDate = {};
  weekDates.forEach(d => { shiftsByDate[formatDate(d)] = []; });
  shifts.forEach(s => {
    const key = typeof s.shift_date === "string" ? s.shift_date.slice(0, 10) : formatDate(new Date(s.shift_date));
    if (shiftsByDate[key]) shiftsByDate[key].push(s);
  });

  // Get all employees flat
  const allEmployees = Object.values(employees).flat();
  const departments = Object.keys(employees);

  // Filtered employees
  const filteredEmployees = deptFilter
    ? { [deptFilter]: employees[deptFilter] || [] }
    : employees;

  // Staffing summary per day
  const staffingSummary = weekDates.map(d => {
    const dateStr = formatDate(d);
    const dayShifts = shiftsByDate[dateStr] || [];
    const depts = {};
    dayShifts.forEach(s => {
      const dept = s.department || "Unassigned";
      depts[dept] = (depts[dept] || 0) + 1;
    });
    return { date: dateStr, total: dayShifts.length, depts };
  });

  // ── Drag & Drop Handlers ───────────────────────────────────────
  async function handleDrop(e, dateStr) {
    e.preventDefault(); setDragOver(null);
    try {
      const data = JSON.parse(e.dataTransfer.getData("application/json"));
      if (data.type === "employee") {
        setShowAddModal({ date: dateStr, userId: data.userId, userName: data.name });
      } else if (data.type === "shift") {
        if (data.shiftId) {
          await auth.updateShift(data.shiftId, { shiftDate: dateStr });
          await load();
          setToast({ msg: "Shift moved successfully", type: "success" });
        }
      }
    } catch (err) { setToast({ msg: err.message || "Drop failed", type: "error" }); }
  }

  function handleDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }

  // ── CRUD Handlers ──────────────────────────────────────────────
  async function createShift(data) {
    try { await auth.createShift(data); setShowAddModal(null); setToast({ msg: "Shift created!", type: "success" }); await load(); }
    catch (err) { setToast({ msg: err.message, type: "error" }); }
  }

  async function deleteShift(id) {
    if (!confirm("Delete this shift?")) return;
    try { await auth.deleteShift(id); setToast({ msg: "Shift deleted", type: "success" }); await load(); }
    catch (err) { setToast({ msg: err.message, type: "error" }); }
  }

  async function applyTemplateToWeek(template) {
    try {
      const bulkShifts = [];
      for (let i = 0; i < 5; i++) {
        const d = new Date(weekDates[i]);
        if (d.getDay() === 0 || d.getDay() === 6) continue;
        const dateStr = formatDate(d);
        for (const emp of allEmployees.slice(0, 15)) {
          bulkShifts.push({ userId: emp.id, shiftDate: dateStr, shiftStart: template.start, shiftEnd: template.end, department: emp.department });
        }
      }
      if (!bulkShifts.length) { setToast({ msg: "No shifts to create", type: "info" }); return; }
      const result = await auth.bulkCreateShifts(bulkShifts);
      setShowTemplateModal(false);
      setToast({ msg: `Created ${result.created} shifts (${result.skipped} overlaps skipped)`, type: "success" });
      await load();
    } catch (err) { setToast({ msg: err.message, type: "error" }); }
  }

  async function seedDemo() {
    try { await auth.seedDemoShifts(); setToast({ msg: "Demo shifts seeded!", type: "success" }); await load(); }
    catch (err) { setToast({ msg: err.message, type: "error" }); }
  }

  // ── AI Handlers ────────────────────────────────────────────────
  async function loadForecast() {
    setAiLoading(true);
    try {
      const data = await auth.fetchDemandForecast({ from, to });
      setForecast(data);
    } catch (err) { setToast({ msg: err.message, type: "error" }); }
    finally { setAiLoading(false); }
  }

  async function loadPreferences() {
    try {
      const data = await auth.fetchEmployeePreferences();
      setPreferences(data);
    } catch (err) { setToast({ msg: err.message, type: "error" }); }
  }

  async function runAutoSchedule() {
    setAiLoading(true);
    try {
      const result = await auth.autoSchedule({ from, to, clearExisting });
      setAutoResult(result);
      setShowAIModal("results");
      setToast({ msg: `AI generated ${result.created} shifts!`, type: "success" });
      await load();
    } catch (err) { setToast({ msg: err.message, type: "error" }); }
    finally { setAiLoading(false); }
  }

  async function savePreferences(prefs) {
    try {
      await auth.bulkSavePreferences(prefs);
      setToast({ msg: "Preferences saved!", type: "success" });
      await loadPreferences();
    } catch (err) { setToast({ msg: err.message, type: "error" }); }
  }

  // ── Navigation ─────────────────────────────────────────────────
  function prevWeek() { const d = new Date(currentDate); d.setDate(d.getDate() - 7); setCurrentDate(d); }
  function nextWeek() { const d = new Date(currentDate); d.setDate(d.getDate() + 7); setCurrentDate(d); }
  function thisWeek() { setCurrentDate(new Date()); }

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
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
          <h1 className="text-2xl font-semibold tracking-tight">Shift Scheduling</h1>
          <p className="text-slate-500 text-sm mt-1">Drag employees onto the calendar or use AI to auto-generate optimal schedules</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-secondary btn-sm" onClick={seedDemo}><Zap size={14}/> Seed Demo</button>
          <button className="btn-secondary btn-sm" onClick={() => setShowTemplateModal(true)}><Copy size={14}/> Templates</button>
          <button className="btn-sm bg-gradient-to-r from-violet-500 to-purple-600 text-white font-semibold flex items-center gap-1.5 px-4 py-2 rounded-xl shadow-lg shadow-violet-500/20 hover:shadow-xl transition"
            onClick={() => { setShowAIModal("forecast"); loadForecast(); }}>
            <Brain size={14}/> AI Auto-Schedule
          </button>
          <button className={`btn-sm font-semibold flex items-center gap-1.5 px-4 py-2 rounded-xl transition ${conflicts.summary?.critical > 0 ? "bg-gradient-to-r from-rose-500 to-red-600 text-white shadow-lg shadow-rose-500/20 hover:shadow-xl animate-pulse" : conflicts.summary?.warnings > 0 ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/20 hover:shadow-xl" : "bg-white dark:bg-navy-800 border border-slate-200 dark:border-slate-700 text-slate-600 hover:bg-slate-50"}`}
            onClick={() => { setShowConflictPanel(true); }}>
            <AlertTriangle size={14}/> Conflicts {conflicts.summary?.total > 0 && <span className="ml-0.5 h-5 w-5 rounded-full bg-white/20 text-[10px] font-bold grid place-items-center">{conflicts.summary.total}</span>}
          </button>
          <button className="btn-sm font-semibold flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white dark:bg-navy-800 border border-slate-200 dark:border-slate-700 text-slate-600 hover:bg-slate-50 transition"
            onClick={() => { setShowCostPanel(true); loadCostAnalysis(); }}>
            <CircleDollarSign size={14}/> Costs
          </button>
          <select className="select h-9 w-36 text-xs" value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
            <option value="">All Departments</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      {/* Week Navigation */}
      <div className="flex items-center justify-between mb-4 bg-white dark:bg-navy-800 rounded-2xl p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <button className="h-9 w-9 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center transition" onClick={prevWeek}><ChevronLeft size={18}/></button>
          <button className="h-9 px-3 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 text-sm font-medium transition" onClick={thisWeek}>Today</button>
          <button className="h-9 w-9 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center transition" onClick={nextWeek}><ChevronRight size={18}/></button>
        </div>
        <div className="text-sm font-semibold">{formatMonth(weekDates[0])} {weekDates[0].getFullYear()}</div>
        <div className="text-xs text-slate-500">{from} → {to}</div>
      </div>

      {/* Staffing Summary Bar */}
      <div className="grid grid-cols-7 gap-1 mb-4">
        {staffingSummary.map(s => <div key={s.date} className="bg-white dark:bg-navy-800 rounded-xl p-2 text-center shadow-sm">
          <div className="text-[10px] text-slate-500">{formatDayName(new Date(s.date))}</div>
          <div className="text-lg font-bold">{s.total}</div>
          <div className="text-[10px] text-slate-400">shifts</div>
        </div>)}
      </div>

      {/* Main Layout: Calendar + Sidebar */}
      <div className="flex gap-4">
        {/* Calendar Grid */}
        <div className="flex-1 overflow-x-auto">
          <div className="grid grid-cols-7 gap-1 min-w-[700px]">
            {weekDates.map(d => {
              const dateStr = formatDate(d);
              const dayShifts = shiftsByDate[dateStr] || [];
              const isOver = dragOver === dateStr;
              const dayConflicts = conflictsByDate[dateStr] || [];
              const hasCritical = dayConflicts.some(c => c.severity === "CRITICAL");
              const hasWarning = dayConflicts.some(c => c.severity === "WARNING");
              const borderColor = isOver ? "border-brand-400 bg-brand-50/50 dark:bg-brand-900/10"
                : hasCritical ? "border-rose-300 dark:border-rose-700 bg-rose-50/30 dark:bg-rose-900/5"
                : hasWarning ? "border-amber-200 dark:border-amber-700 bg-amber-50/20 dark:bg-amber-900/5"
                : "border-slate-100 dark:border-slate-800 bg-white dark:bg-navy-800";
              return (
                <div key={dateStr}
                  className={`min-h-[200px] rounded-2xl border-2 transition ${borderColor} ${isToday(d) ? "ring-2 ring-brand-400/30" : ""}`}
                  onDragOver={handleDragOver}
                  onDragEnter={(e) => { e.preventDefault(); setDragOver(dateStr); }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={(e) => handleDrop(e, dateStr)}>
                  <div className={`px-3 py-2 border-b border-slate-100 dark:border-slate-700/50 flex items-center justify-between ${isToday(d) ? "bg-brand-50/50 dark:bg-brand-900/10 rounded-t-xl" : ""}`}>
                    <div className="flex items-center gap-2">
                      <div>
                        <div className="text-[10px] font-medium text-slate-500 uppercase">{formatDayName(d)}</div>
                        <div className={`text-lg font-bold ${isToday(d) ? "text-brand-600" : ""}`}>{formatDayNum(d)}</div>
                      </div>
                      {dayConflicts.length > 0 && (
                        <button className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-[10px] font-semibold bg-white dark:bg-navy-800 border shadow-sm cursor-pointer hover:shadow-md transition" title={dayConflicts.map(c => c.message).join("\n")} onClick={() => setShowConflictPanel(true)}>
                          {hasCritical ? <AlertTriangle size={10} className="text-rose-500"/> : <AlertTriangle size={10} className="text-amber-500"/>}
                          <span className={hasCritical ? "text-rose-600" : "text-amber-600"}>{dayConflicts.length}</span>
                        </button>
                      )}
                    </div>
                    <button className="h-6 w-6 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center transition" onClick={() => setShowAddModal({ date: dateStr })}>
                      <Plus size={14} className="text-slate-400"/>
                    </button>
                  </div>
                  <div className="p-1.5 space-y-0.5">
                    {dayShifts.map(s => {
                      const shiftConflicts = dayConflicts.filter(c => c.employeeId === s.user_id || c.shiftIds?.includes(s.id));
                      return <ShiftCard key={s.id} shift={s} onDelete={deleteShift} onEdit={(shift) => setShowAddModal({ date: dateStr, editShift: shift })} onSwap={(shift) => setShowSwapModal(shift)} hasConflict={shiftConflicts.length > 0} conflictSeverity={shiftConflicts[0]?.severity}/>
                    })}
                    {!dayShifts.length && <div className="text-center py-8 text-[10px] text-slate-300 dark:text-slate-600">Drop here</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Employee Sidebar */}
        <div className="w-64 shrink-0 hidden xl:block">
          <div className="bg-white dark:bg-navy-800 rounded-2xl shadow-sm sticky top-20">
            <div className="p-4 border-b border-slate-100 dark:border-slate-700/50">
              <h3 className="font-semibold text-sm flex items-center gap-2"><Users size={16}/> Employees</h3>
              <p className="text-[10px] text-slate-500 mt-1">Drag onto calendar to assign</p>
            </div>
            <div className="p-3 max-h-[calc(100vh-200px)] overflow-y-auto space-y-3">
              {Object.entries(filteredEmployees).map(([dept, emps]) => (
                <div key={dept}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`h-2 w-2 rounded-full ${getDeptColor(dept)}`}/>
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{dept}</span>
                    <span className="text-[10px] text-slate-400">{emps.length}</span>
                  </div>
                  <div className="space-y-1.5">
                    {emps.map(emp => <EmployeeCard key={emp.id} employee={emp}/>)}
                  </div>
                </div>
              ))}
              {allEmployees.length === 0 && <div className="text-center py-8 text-slate-400 text-xs">No employees found</div>}
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-4 p-4 bg-white dark:bg-navy-800 rounded-2xl shadow-sm">
        <div className="text-xs font-medium text-slate-500 mr-2">Shift Types:</div>
        {SHIFT_TEMPLATES.map(t => <div key={t.name} className="flex items-center gap-1.5">
          <div className={`h-3 w-3 rounded ${t.dotColor}`}/><span className="text-xs text-slate-600 dark:text-slate-400">{t.name} ({t.start}–{t.end})</span>
        </div>)}
      </div>

      {/* ═══════════ ADD/EDIT SHIFT MODAL ═══════════ */}
      {showAddModal && <AddShiftModal
        date={showAddModal.date}
        employees={allEmployees}
        editShift={showAddModal.editShift}
        onCreate={createShift}
        onEdit={async (data) => {
          try { await auth.updateShift(showAddModal.editShift.id, data); setShowAddModal(null); setToast({ msg: "Shift updated!", type: "success" }); await load(); }
          catch (err) { setToast({ msg: err.message, type: "error" }); }
        }}
        onDelete={async () => {
          try { await auth.deleteShift(showAddModal.editShift.id); setShowAddModal(null); setToast({ msg: "Shift deleted", type: "success" }); await load(); }
          catch (err) { setToast({ msg: err.message, type: "error" }); }
        }}
        onClose={() => setShowAddModal(null)}
        defaultUserId={showAddModal.userId}
      />}

      {/* ═══════════ TEMPLATE MODAL ═══════════ */}
      {showTemplateModal && <div className="modal-overlay" onClick={() => setShowTemplateModal(false)}>
        <div className="modal-content max-w-md p-6" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-xl font-semibold">Shift Templates</h2>
            <button className="btn-ghost btn-icon btn-sm" onClick={() => setShowTemplateModal(false)}><X size={18}/></button>
          </div>
          <p className="text-sm text-slate-500 mb-4">Apply a template to fill the current week with standard shifts for all active employees (Mon–Fri).</p>
          <div className="space-y-2">
            {SHIFT_TEMPLATES.map(t => <button key={t.name} className={`w-full p-4 rounded-xl border-2 text-left hover:shadow-md transition flex items-center justify-between ${t.color}`} onClick={() => applyTemplateToWeek(t)}>
              <div><div className="font-semibold text-sm">{t.name} Shift</div><div className="text-xs opacity-70 mt-0.5">{t.start} – {t.end}</div></div>
              <div className="text-xs opacity-50">Apply →</div>
            </button>)}
          </div>
          <div className="mt-4 p-3 rounded-xl bg-slate-50 dark:bg-navy-900 text-xs text-slate-500">
            <AlertTriangle size={14} className="inline mr-1"/> Overlapping shifts are automatically skipped. Weekend shifts are excluded.
          </div>
        </div>
      </div>}

      {/* ═══════════ AI AUTO-SCHEDULE MODAL ═══════════ */}
      {showAIModal && <div className="modal-overlay" onClick={() => setShowAIModal(null)}>
        <div className="modal-content max-w-xl p-6 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 grid place-items-center text-white">
                <Brain size={20}/>
              </div>
              <div>
                <h2 className="text-xl font-semibold">AI Auto-Schedule</h2>
                <p className="text-xs text-slate-500">Intelligent shift planning for {from} → {to}</p>
              </div>
            </div>
            <button className="btn-ghost btn-icon btn-sm" onClick={() => setShowAIModal(null)}><X size={18}/></button>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-5">
            {[["forecast", TrendingUp, "Demand Forecast"], ["preferences", Settings, "Preferences"], ["auto", Zap, "Generate"]].map(([key, Icon, label]) => (
              <button key={key} className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition flex items-center justify-center gap-1.5 ${showAIModal === key ? "bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400" : "bg-slate-50 dark:bg-slate-800 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"}`}
                onClick={() => { setShowAIModal(key); if (key === "forecast" && !forecast) loadForecast(); if (key === "preferences" && !preferences.length) loadPreferences(); }}>
                <Icon size={14}/> {label}
              </button>
            ))}
          </div>

          {/* Content */}
          {showAIModal === "forecast" && (
            aiLoading ? <div className="text-center py-12"><div className="h-12 w-12 rounded-full bg-violet-100 grid place-items-center mx-auto mb-3 animate-pulse"><Brain size={24} className="text-violet-500"/></div><p className="text-sm text-slate-500">Analyzing demand patterns...</p></div>
            : <DemandForecastPanel forecast={forecast}/>
          )}

          {showAIModal === "preferences" && (
            <PreferencesPanel employees={allEmployees} preferences={preferences} onSave={savePreferences}/>
          )}

          {showAIModal === "auto" && (
            <div className="space-y-5">
              <div className="bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-900/10 dark:to-purple-900/10 rounded-2xl p-5 border border-violet-200 dark:border-violet-800">
                <h4 className="font-semibold text-sm mb-3 flex items-center gap-2"><Lightbulb size={14} className="text-violet-500"/> How AI Scheduling Works</h4>
                <div className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
                  <div className="flex items-start gap-2"><ShieldCheck size={12} className="text-violet-500 mt-0.5 shrink-0"/><span>Analyzes occupancy forecast to determine staffing needs per department</span></div>
                  <div className="flex items-start gap-2"><Star size={12} className="text-violet-500 mt-0.5 shrink-0"/><span>Respects employee preferred shifts, work days, and max weekly hours</span></div>
                  <div className="flex items-start gap-2"><Users size={12} className="text-violet-500 mt-0.5 shrink-0"/><span>Ensures minimum coverage for each department every day</span></div>
                  <div className="flex items-start gap-2"><AlertTriangle size={12} className="text-violet-500 mt-0.5 shrink-0"/><span>Flags understaffing risks and approaches to max hour limits</span></div>
                  <div className="flex items-start gap-2"><Zap size={12} className="text-violet-500 mt-0.5 shrink-0"/><span>Prevents double-booking and overlapping shifts automatically</span></div>
                </div>
              </div>

              <label className="flex items-center gap-3 p-4 bg-white dark:bg-navy-800 rounded-xl border border-slate-100 dark:border-slate-700 cursor-pointer">
                <input type="checkbox" checked={clearExisting} onChange={e => setClearExisting(e.target.checked)} className="h-4 w-4 rounded accent-violet-500"/>
                <div>
                  <div className="text-sm font-medium">Clear existing shifts first</div>
                  <div className="text-xs text-slate-500">Remove all shifts in this date range before generating new ones</div>
                </div>
              </label>

              <button className="w-full h-14 rounded-2xl bg-gradient-to-r from-violet-500 to-purple-600 text-white font-semibold text-base flex items-center justify-center gap-2 shadow-xl shadow-violet-500/20 hover:shadow-2xl transition disabled:opacity-50"
                onClick={runAutoSchedule} disabled={aiLoading}>
                {aiLoading ? <><div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin"/> Generating...</> : <><Brain size={18}/> Generate Optimal Schedule</>}
              </button>
            </div>
          )}

          {showAIModal === "results" && <AutoScheduleResults result={autoResult} onClose={() => { setShowAIModal(null); setAutoResult(null); }}/>}
        </div>
      </div>}

      {/* ═══════════ SWAP REQUEST MODAL ═══════════ */}
      {showSwapModal && <RequestSwapModal auth={auth} shift={showSwapModal} onClose={() => setShowSwapModal(null)} onSubmit={() => { setShowSwapModal(null); setToast({ msg: "Swap request submitted!", type: "success" }); }}/>}

      {/* ═══════════ CONFLICT ALERTS PANEL ═══════════ */}
      {showConflictPanel && <div className="modal-overlay" onClick={() => setShowConflictPanel(false)}>
        <div className="modal-content max-w-xl p-6 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className={`h-10 w-10 rounded-xl grid place-items-center text-white ${conflicts.summary?.critical > 0 ? "bg-gradient-to-br from-rose-500 to-red-600" : conflicts.summary?.warnings > 0 ? "bg-gradient-to-br from-amber-500 to-orange-500" : "bg-gradient-to-br from-emerald-500 to-green-600"}`}>
                <AlertTriangle size={20}/>
              </div>
              <div>
                <h2 className="text-xl font-semibold">Schedule Health Check</h2>
                <p className="text-xs text-slate-500">Auto-detected issues for {from} → {to}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="h-8 w-8 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center transition" onClick={() => loadConflicts()} title="Refresh"><RefreshCw size={16} className={conflictLoading ? "animate-spin" : ""}/></button>
              <button className="h-8 w-8 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center" onClick={() => setShowConflictPanel(false)}><X size={18}/></button>
            </div>
          </div>
          <ConflictAlertsPanel conflicts={conflicts.conflicts} summary={conflicts.summary} loading={conflictLoading} onRefresh={loadConflicts} onClose={() => setShowConflictPanel(false)}/>
        </div>
      </div>}

      {/* ═══════════ LABOR COST PANEL ═══════════ */}
      {showCostPanel && <div className="modal-overlay" onClick={() => setShowCostPanel(false)}>
        <div className="modal-content max-w-xl p-6 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 grid place-items-center text-white"><CircleDollarSign size={20}/></div>
              <div>
                <h2 className="text-xl font-semibold">Labor Cost Analysis</h2>
                <p className="text-xs text-slate-500">Cost breakdown and optimization for {from} → {to}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="h-8 w-8 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center transition" onClick={() => loadCostAnalysis()} title="Refresh"><RefreshCw size={16} className={costLoading ? "animate-spin" : ""}/></button>
              <button className="h-8 w-8 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center" onClick={() => setShowCostPanel(false)}><X size={18}/></button>
            </div>
          </div>
          <CostOptimizationPanel costData={costData} loading={costLoading}/>
        </div>
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ADD/EDIT SHIFT MODAL
// ═══════════════════════════════════════════════════════════════════
function AddShiftModal({ date, employees, editShift, onCreate, onEdit, onDelete, onClose, defaultUserId }) {
  const [form, setForm] = useState({
    userId: defaultUserId || editShift?.user_id || "",
    shiftStart: editShift?.shift_start?.slice(0, 5) || "08:00",
    shiftEnd: editShift?.shift_end?.slice(0, 5) || "16:00",
    notes: editShift?.notes || "",
    template: ""
  });

  function applyTemplate(name) {
    const t = SHIFT_TEMPLATES.find(tmpl => tmpl.name === name);
    if (t) setForm({ ...form, shiftStart: t.start, shiftEnd: t.end, template: name });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const data = {
      userId: Number(form.userId),
      shiftDate: date,
      shiftStart: form.shiftStart,
      shiftEnd: form.shiftEnd,
      notes: form.notes || null
    };
    if (editShift) await onEdit(data);
    else await onCreate(data);
  }

  return <div className="modal-overlay" onClick={onClose}>
    <div className="modal-content max-w-md p-6" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-semibold">{editShift ? "Edit Shift" : "New Shift"}</h2>
          <p className="text-sm text-slate-500">{new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
        </div>
        <button className="btn-ghost btn-icon btn-sm" onClick={onClose}><X size={18}/></button>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-sm text-slate-500 mb-1 block">Employee</label>
          <select className="select" value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value })} required>
            <option value="">Select employee…</option>
            {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name} ({emp.department || "—"})</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm text-slate-500 mb-1 block">Quick Template</label>
          <div className="flex flex-wrap gap-1.5">
            {SHIFT_TEMPLATES.map(t => <button key={t.name} type="button" className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${form.template === t.name ? t.color + " border-current" : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"}`} onClick={() => applyTemplate(t.name)}>
              {t.name}
            </button>)}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm text-slate-500 mb-1 block">Start Time</label>
            <input type="time" className="input" value={form.shiftStart} onChange={e => setForm({ ...form, shiftStart: e.target.value, template: "" })} required/>
          </div>
          <div>
            <label className="text-sm text-slate-500 mb-1 block">End Time</label>
            <input type="time" className="input" value={form.shiftEnd} onChange={e => setForm({ ...form, shiftEnd: e.target.value, template: "" })} required/>
          </div>
        </div>
        {form.shiftStart && form.shiftEnd && <div className="text-xs text-slate-500 bg-slate-50 dark:bg-navy-900 rounded-xl p-2.5">
          Duration: {(() => {
            const [sh, sm] = form.shiftStart.split(":").map(Number);
            const [eh, em] = form.shiftEnd.split(":").map(Number);
            let mins = (eh * 60 + em) - (sh * 60 + sm);
            if (mins <= 0) mins += 24 * 60;
            return `${Math.floor(mins / 60)}h ${mins % 60}m`;
          })()}
        </div>}
        <div>
          <label className="text-sm text-slate-500 mb-1 block">Notes</label>
          <input className="input" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes…"/>
        </div>
        <div className="flex gap-2 pt-2">
          {editShift && <button type="button" className="btn-danger btn-sm" onClick={() => onDelete()}><Trash2 size={14}/> Delete</button>}
          <div className="flex-1"/>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary">{editShift ? "Update" : "Create"} Shift</button>
        </div>
      </form>
    </div>
  </div>;
}
