import React, { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import ErrorBoundary from "./ErrorBoundary";
import { retryFetch } from "./retryFetch";
import * as Sentry from "@sentry/react";
import GuestMobileApp, { GuestProvider } from "./GuestMobileApp";
import SchedulingPage from "./SchedulingPage";
import ShiftSwapPage from "./ShiftSwapPage";
import { CurrencyProvider, useCurrency } from "./CurrencyContext";
import PaymentModal from "./PaymentModal";
import StatusMonitor from "./StatusMonitor";
import { DEFAULT_SOUNDS, TONE_PRESETS, playNotificationSound, previewTone, previewTypeSound, getSoundPreferences, saveSoundPreferences, getMasterVolume, setMasterVolume, isSoundEnabled, setSoundEnabled } from "./NotificationSounds";
import {
  LayoutDashboard, CalendarDays, BedDouble, Users, ClipboardCheck, Wrench,
  CircleDollarSign, UserRoundCheck, ConciergeBell, Search, Bell, Moon, Sun,
  Menu, X, Crown, Star, ChevronDown, Plus, ArrowUpRight, Clock3, KeyRound,
  CreditCard, MessageSquareText, MoreHorizontal, CheckCircle2, ShieldCheck,
  Sparkles, UtensilsCrossed, Settings, Eye, Edit, Trash2, Filter, Phone,
  Mail, Globe, Award, TrendingUp, BarChart3, Calendar, AlertTriangle,
  Check, XCircle, ChefHat, Flower2, PartyPopper, FileText, Lock, LogOut,
  Building2, MapPin, Wallet, Receipt, Users2, GraduationCap, Heart, ArrowLeftRight, WifiOff
} from "lucide-react";
import {
  AreaChart, Area, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
  BarChart, Bar, PieChart, Pie, Cell, Legend
} from "recharts";

// ═══════════════════════════════════════════════════════════════════
// AUTH CONTEXT
// ═══════════════════════════════════════════════════════════════════
const API = "/api";
const AuthContext = createContext(null);
function useAuth() { return useContext(AuthContext); }

function AuthProvider({ children }) {
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem("rhosam_user") || "null"); } catch { return null; } });
  const [loading, setLoading] = useState(true);
  const [dataVersion, setDataVersion] = useState(0);
  const notifyDataChange = useCallback(() => setDataVersion(v => v + 1), []);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [realtimeToasts, setRealtimeToasts] = useState([]);
  const wsRef = useRef(null);

  // WebSocket connection for real-time notifications
  useEffect(() => {
    const token = localStorage.getItem("rhosam_token");
    if (!token || !user) return;
    let ws;
    let reconnectTimer;
    function connect() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${protocol}//${window.location.host}/ws?token=${token}`);
      wsRef.current = ws;
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "notification") {
            const n = msg.data;
            setNotifications(prev => [n, ...prev].slice(0, 50));
            setUnreadCount(prev => prev + 1);
            // Show toast
            setRealtimeToasts(prev => [...prev, { id: Date.now(), title: n.title, body: n.body, type: n.type }]);
            // Auto-dismiss toast
            setTimeout(() => { setRealtimeToasts(prev => prev.filter(t => t.id !== Date.now())); }, 5000);
            // Play notification sound
            if (isSoundEnabled()) {
              const prefs = getSoundPreferences();
              const typePref = prefs[n.type];
              if (typePref?.enabled !== false) {
                const overrides = typePref?.customTone ? { notes: typePref.customTone.notes, durations: typePref.customTone.durations, waveform: typePref.customTone.waveform } : {};
                if (typePref?.volume != null) overrides.volume = typePref.volume;
                playNotificationSound(n.type, overrides);
              }
            }
          }
        } catch {}
      };
      ws.onclose = () => { reconnectTimer = setTimeout(connect, 3000); };
      ws.onerror = () => { ws.close(); };
    }
    connect();
    return () => { clearTimeout(reconnectTimer); if (ws) ws.close(); };
  }, [user]);

  // Load initial notifications
  useEffect(() => {
    if (!user) return;
    request("/notifications").then(d => { setNotifications(d.notifications || []); setUnreadCount(d.unread || 0); }).catch(() => {});
  }, [user]);

  const logout = useCallback(() => { localStorage.removeItem("rhosam_token"); localStorage.removeItem("rhosam_user"); Sentry.setUser(null); setUser(null); }, []);

  const request = useCallback(async (path, opts = {}) => {
    const token = localStorage.getItem("rhosam_token");
    const r = await retryFetch(`${API}${path}`, { ...opts, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) } });
    if (r.status === 401) logout();
    const t = await r.text(); let d = {}; if (t) try { d = JSON.parse(t); } catch { throw new Error(`Non-JSON (${r.status})`); }
    if (!r.ok) throw new Error(d.message || `Request failed (${r.status})`);
    return d;
  }, [logout]);

  const markNotificationsRead = useCallback(async (ids) => {
    try {
      await request("/notifications/read", { method: "PATCH", body: JSON.stringify({ ids }) });
      if (ids && ids.length) {
        setNotifications(prev => prev.map(n => ids.includes(n.id) ? { ...n, is_read: true } : n));
      } else {
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      }
      setUnreadCount(0);
    } catch {}
  }, [request]);

  const dismissToast = useCallback((id) => { setRealtimeToasts(prev => prev.filter(t => t.id !== id)); }, []);

  useEffect(() => {
    retryFetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${localStorage.getItem("rhosam_token")}` } })
      .then(async r => {
        const t = await r.text(); if (!t) throw new Error('empty');
        try { return JSON.parse(t); } catch { throw new Error('non-JSON'); }
      })
      .then(d => { setUser(d.user); localStorage.setItem("rhosam_user", JSON.stringify(d.user)); })
      .catch(logout).finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    return Sentry.startSpan({ name: "auth.login", op: "user.login" }, async (span) => {
      const r = await retryFetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      span.setAttribute("http.status_code", r.status);
      const t = await r.text(); let d = {}; if (t) try { d = JSON.parse(t); } catch { throw new Error(`Server returned non-JSON response (${r.status})`); }
      if (!r.ok) throw new Error(d.message || `Login failed (${r.status})`);
      localStorage.setItem("rhosam_token", d.token); localStorage.setItem("rhosam_user", JSON.stringify(d.user)); setUser(d.user);
      Sentry.setUser({ id: d.user?.id, email: d.user?.email, username: d.user?.name });
      return d.user;
    });
  }, []);

  const value = useMemo(() => ({
    user, loading, login, logout, request, notifyDataChange, dataVersion,
    fetchDashboard: () => request("/dashboard"),
    fetchRoomTypes: () => request("/room-types"),
    createRoomType: (d) => request("/room-types", { method: "POST", body: JSON.stringify(d) }),
    fetchRooms: (p) => request(`/rooms${p ? `?${new URLSearchParams(p)}` : ""}`),
    fetchRoomAvailability: (ci, co) => request(`/rooms/availability?checkIn=${ci}&checkOut=${co}`),
    updateRoomStatus: (id, d) => request(`/rooms/${id}/status`, { method: "PATCH", body: JSON.stringify(d) }),
    createRoom: (d) => request("/rooms", { method: "POST", body: JSON.stringify(d) }),
    fetchGuests: (s) => request(`/guests${s ? `?search=${encodeURIComponent(s)}` : ""}`),
    fetchGuest: (id) => request(`/guests/${id}`),
    createGuest: (d) => request("/guests", { method: "POST", body: JSON.stringify(d) }),
    updateGuest: (id, d) => request(`/guests/${id}`, { method: "PUT", body: JSON.stringify(d) }),
    fetchReservations: (p) => request(`/reservations${p ? `?${new URLSearchParams(p)}` : ""}`),
    fetchReservation: (id) => request(`/reservations/${id}`),
    createReservation: (d) => request("/reservations", { method: "POST", body: JSON.stringify(d) }),
    updateReservationStatus: (id, s) => request(`/reservations/${id}/status`, { method: "PATCH", body: JSON.stringify({ status: s }) }),
    fetchHousekeeping: (p) => request(`/housekeeping${p ? `?${new URLSearchParams(p)}` : ""}`),
    createHousekeepingTask: (d) => request("/housekeeping", { method: "POST", body: JSON.stringify(d) }),
    updateHousekeepingTask: (id, d) => request(`/housekeeping/${id}`, { method: "PATCH", body: JSON.stringify(d) }),
    fetchMaintenance: (p) => request(`/maintenance${p ? `?${new URLSearchParams(p)}` : ""}`),
    createMaintenanceRequest: (d) => request("/maintenance", { method: "POST", body: JSON.stringify(d) }),
    updateMaintenanceRequest: (id, d) => request(`/maintenance/${id}`, { method: "PATCH", body: JSON.stringify(d) }),
    fetchUsers: () => request("/users"),
    createUser: (d) => request("/users", { method: "POST", body: JSON.stringify(d) }),
    updateUser: (id, d) => request(`/users/${id}`, { method: "PATCH", body: JSON.stringify(d) }),
    fetchNotifications: () => request("/notifications"),
    addCharge: (fId, d) => request(`/folios/${fId}/charge`, { method: "POST", body: JSON.stringify(d) }),
    addPayment: (fId, d) => request(`/folios/${fId}/payment`, { method: "POST", body: JSON.stringify(d) }),
    fetchMenu: () => request("/restaurant/menu"),
    createMenuItem: (d) => request("/restaurant/menu", { method: "POST", body: JSON.stringify(d) }),
    fetchRestaurantOrders: (p) => request(`/restaurant/orders${p ? `?${new URLSearchParams(p)}` : ""}`),
    createRestaurantOrder: (d) => request("/restaurant/orders", { method: "POST", body: JSON.stringify(d) }),
    updateRestaurantOrder: (id, d) => request(`/restaurant/orders/${id}`, { method: "PATCH", body: JSON.stringify(d) }),
    fetchSpaServices: () => request("/spa/services"),
    fetchSpaAppointments: () => request("/spa/appointments"),
    createSpaAppointment: (d) => request("/spa/appointments", { method: "POST", body: JSON.stringify(d) }),
    updateSpaAppointment: (id, d) => request(`/spa/appointments/${id}`, { method: "PATCH", body: JSON.stringify(d) }),
    fetchEvents: () => request("/events"),
    createEvent: (d) => request("/events", { method: "POST", body: JSON.stringify(d) }),
    updateEvent: (id, d) => request(`/events/${id}`, { method: "PATCH", body: JSON.stringify(d) }),
    fetchFinanceSummary: () => request("/finance/summary"),
    fetchExpenses: () => request("/finance/expenses"),
    createExpense: (d) => request("/finance/expenses", { method: "POST", body: JSON.stringify(d) }),
    updateExpense: (id, d) => request(`/finance/expenses/${id}`, { method: "PATCH", body: JSON.stringify(d) }),
    fetchExpenseCategories: () => request("/finance/expense-categories"),
    fetchSecurityIncidents: () => request("/security/incidents"),
    createSecurityIncident: (d) => request("/security/incidents", { method: "POST", body: JSON.stringify(d) }),
    updateSecurityIncident: (id, d) => request(`/security/incidents/${id}`, { method: "PATCH", body: JSON.stringify(d) }),
    fetchGuestRequests: (p) => request(`/guest-requests${p ? `?${new URLSearchParams(p)}` : ""}`),
    createGuestRequest: (d) => request("/guest-requests", { method: "POST", body: JSON.stringify(d) }),
    updateGuestRequest: (id, d) => request(`/guest-requests/${id}`, { method: "PATCH", body: JSON.stringify(d) }),
    fetchShifts: (p) => request(`/shifts${p ? `?${new URLSearchParams(p)}` : ""}`),
    createShift: (d) => request("/shifts", { method: "POST", body: JSON.stringify(d) }),
    updateShift: (id, d) => request(`/shifts/${id}`, { method: "PATCH", body: JSON.stringify(d) }),
    deleteShift: (id) => request(`/shifts/${id}`, { method: "DELETE" }),
    bulkCreateShifts: (shifts) => request("/shifts/bulk", { method: "POST", body: JSON.stringify({ shifts }) }),
    fetchShiftEmployees: (p) => request(`/shifts/employees${p ? `?${new URLSearchParams(p)}` : ""}`),
    fetchShiftStats: (p) => request(`/shifts/stats${p ? `?${new URLSearchParams(p)}` : ""}`),
    seedDemoShifts: () => request("/shifts/seed-demo", { method: "POST" }),
    fetchDemandForecast: (p) => request(`/shifts/demand-forecast${p ? `?${new URLSearchParams(p)}` : ""}`),
    autoSchedule: (d) => request("/shifts/auto-schedule", { method: "POST", body: JSON.stringify(d) }),
    fetchShiftConflicts: (p) => request(`/shifts/conflicts${p ? `?${new URLSearchParams(p)}` : ""}`),
    fetchEmployeePreferences: () => request("/employee-preferences"),
    saveEmployeePreference: (d) => request("/employee-preferences", { method: "POST", body: JSON.stringify(d) }),
    bulkSavePreferences: (prefs) => request("/employee-preferences/bulk", { method: "POST", body: JSON.stringify({ preferences: prefs }) }),
    fetchShiftSwaps: (p) => request(`/shift-swaps${p ? `?${new URLSearchParams(p)}` : ""}`),
    createShiftSwap: (d) => request("/shift-swaps", { method: "POST", body: JSON.stringify(d) }),
    approveShiftSwap: (id, d) => request(`/shift-swaps/${id}/approve`, { method: "POST", body: JSON.stringify(d || {}) }),
    rejectShiftSwap: (id, d) => request(`/shift-swaps/${id}/reject`, { method: "POST", body: JSON.stringify(d || {}) }),
    cancelShiftSwap: (id) => request(`/shift-swaps/${id}`, { method: "DELETE" }),
    fetchSwapTargets: (shiftId) => request(`/shift-swaps/potential-targets/${shiftId}`),
    fetchShiftSwapAnalytics: (days) => request(`/shift-swaps/analytics${days ? `?days=${days}` : ""}`),
    fetchPayRates: () => request("/labor/pay-rates"),
    savePayRate: (d) => request("/labor/pay-rates", { method: "POST", body: JSON.stringify(d) }),
    bulkSavePayRates: (rates) => request("/labor/pay-rates/bulk", { method: "POST", body: JSON.stringify({ rates }) }),
    fetchCostAnalysis: (p) => request(`/labor/cost-analysis${p ? `?${new URLSearchParams(p)}` : ""}`),
    fetchAuditLogs: () => request("/audit-logs"),
    globalSearch: (q) => request(`/search?q=${encodeURIComponent(q)}`),
    fetchCurrencies: () => request("/currencies"),
    updateCurrencies: (d) => request("/currencies", { method: "PATCH", body: JSON.stringify(d) }),
    convertCurrency: (d) => request("/currencies/convert", { method: "POST", body: JSON.stringify(d) }),
    fetchPaymentGateways: () => request("/payment-gateways"),
    updatePaymentGateways: (d) => request("/payment-gateways", { method: "PATCH", body: JSON.stringify(d) }),
    processPayment: (d) => request("/payments/process", { method: "POST", body: JSON.stringify(d) }),
    fetchPayments: () => request("/payments"),
    refundPayment: (txnId) => request(`/payments/refund/${txnId}`, { method: "POST" }),
    fetchExchangeRates: () => request("/exchange-rates"),
    notifications, unreadCount, markNotificationsRead, realtimeToasts, dismissToast,
    fetchNotificationPreferences: () => request("/notification-preferences"),
    updateNotificationPreferences: (d) => request("/notification-preferences", { method: "PATCH", body: JSON.stringify(d) }),
  }), [user, loading, dataVersion, notifications, unreadCount, realtimeToasts]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ═══════════════════════════════════════════════════════════════════
// LAYOUT
// ═══════════════════════════════════════════════════════════════════
const NAV = [
  ["Overview", LayoutDashboard], ["Reservations", CalendarDays], ["Front Desk", ConciergeBell],
  ["Rooms", BedDouble], ["Guests", Users], ["Housekeeping", ClipboardCheck],
  ["Food & Beverage", UtensilsCrossed], ["Spa & Wellness", Flower2],
  ["Events", PartyPopper], ["Maintenance", Wrench], ["Finance", CircleDollarSign],
  ["Team", UserRoundCheck], ["Scheduling", Calendar], ["Swaps", ArrowLeftRight], ["Security", ShieldCheck], ["Settings", Settings]
];

const NAV_ROLES = {
  Overview: ["ADMIN","MANAGER","FRONT_DESK","HOUSEKEEPING","RESTAURANT","MAINTENANCE","STAFF"],
  Reservations: ["ADMIN","MANAGER","FRONT_DESK"],
  "Front Desk": ["ADMIN","MANAGER","FRONT_DESK"],
  Rooms: ["ADMIN","MANAGER","FRONT_DESK","HOUSEKEEPING"],
  Guests: ["ADMIN","MANAGER","FRONT_DESK"],
  Housekeeping: ["ADMIN","MANAGER","HOUSEKEEPING"],
  "Food & Beverage": ["ADMIN","MANAGER","RESTAURANT","FRONT_DESK"],
  "Spa & Wellness": ["ADMIN","MANAGER","FRONT_DESK"],
  Events: ["ADMIN","MANAGER"],
  Maintenance: ["ADMIN","MANAGER","MAINTENANCE"],
  Finance: ["ADMIN","MANAGER"],
  Team: ["ADMIN","MANAGER"],
  Scheduling: ["ADMIN","MANAGER"],
  Swaps: ["ADMIN","MANAGER","FRONT_DESK","HOUSEKEEPING","MAINTENANCE","STAFF"],
  Security: ["ADMIN","MANAGER"],
  Settings: ["ADMIN"],
};

function CurrencySelector() {
  const { baseCurrency, currencies, enabledCurrencies, changeBaseCurrency } = useCurrency();
  const [open, setOpen] = useState(false);
  if (!currencies) return null;
  return <div className="relative">
    <button className="h-9 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm font-medium flex items-center gap-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 transition" onClick={() => setOpen(!open)}>
      <Globe size={14}/>{baseCurrency}
    </button>
    {open && <div className="absolute top-full right-0 mt-2 bg-white dark:bg-navy-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 z-50 py-2 min-w-[180px]">
      <div className="px-3 py-1.5 text-xs font-medium text-slate-500 uppercase">Currency</div>
      {enabledCurrencies.map(code => {
        const c = currencies[code];
        return <button key={code} className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2.5 hover:bg-slate-50 dark:hover:bg-navy-900 transition ${baseCurrency === code ? "text-brand-600 font-semibold" : ""}`} onClick={() => { changeBaseCurrency(code); setOpen(false); }}>
          <span className="text-base w-5 text-center">{c?.symbol}</span><span>{code}</span><span className="text-xs text-slate-400 ml-auto">{c?.name}</span>
        </button>;
      })}
    </div>}
  </div>;
}

function Layout({ children }) {
  const { user, logout, notifications, unreadCount, markNotificationsRead, realtimeToasts, dismissToast, globalSearch } = useAuth();
  const navigate = useNavigate(); const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem("rhosam_theme") === "dark");
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const active = location.pathname.slice(1) || "overview";

  useEffect(() => { document.documentElement.classList.toggle("dark", dark); localStorage.setItem("rhosam_theme", dark ? "dark" : "light"); }, [dark]);

  const handleSearch = useCallback(async (q) => {
    setSearchQ(q);
    if (!q || q.length < 2) { setSearchResults(null); return; }
    try { setSearchResults(await globalSearch(q)); } catch { setSearchResults(null); }
  }, [globalSearch]);

  const filteredNav = NAV.filter(([n]) => (NAV_ROLES[n] || []).includes(user?.role));

  const navTo = (n) => { navigate(`/${n.toLowerCase().replace(/ & /g, "-").replace(/ /g, "-")}`); setSidebarOpen(false); };

  return (
    <div className={dark ? "dark" : ""}>
      <div className="min-h-screen bg-[#f5f7fb] dark:bg-navy-950 text-slate-800 dark:text-slate-100">
        {/* Real-Time Toast Notifications */}
        {realtimeToasts.length > 0 && <div className="fixed top-4 right-4 z-[100] space-y-2 max-w-sm">
          {realtimeToasts.slice(-3).map(toast => {
            const typeBg = { ROOM_SERVICE: "bg-emerald-500", SPA: "bg-violet-500", HOUSEKEEPING: "bg-sky-500", MAINTENANCE: "bg-amber-500", SECURITY: "bg-rose-500", SHIFT: "bg-brand-500" };
            return <div key={toast.id} className={`${typeBg[toast.type] || "bg-navy-900"} text-white px-4 py-3 rounded-2xl shadow-2xl text-sm flex items-start gap-3 animate-slide-down`}>
              <Bell size={16} className="shrink-0 mt-0.5"/>
              <div className="min-w-0 flex-1"><div className="font-semibold text-xs">{toast.title}</div><div className="text-xs opacity-80 mt-0.5 line-clamp-2">{toast.body}</div></div>
              <button className="shrink-0 opacity-60 hover:opacity-100" onClick={() => dismissToast(toast.id)}><X size={14}/></button>
            </div>;
          })}
        </div>}
        {/* Desktop Sidebar */}
        <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 bg-navy-900 text-white px-4 py-5 flex-col z-30">
          <div className="flex items-center gap-3 px-2 mb-8 cursor-pointer" onClick={() => navTo("Overview")}>
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-brand-300 to-brand-500 grid place-items-center text-navy-950 shadow-lg shadow-brand-400/20"><Crown size={22}/></div>
            <div><div className="font-semibold tracking-wide text-white">RHoSAM</div><div className="text-[10px] tracking-[.24em] text-brand-300">HOTEL & SUITES</div></div>
          </div>
          <nav className="space-y-1 flex-1 overflow-y-auto">{filteredNav.map(([n, I]) => (
            <button key={n} onClick={() => navTo(n)} className={`nav-item ${active === n.toLowerCase().replace(/ & /g, "-").replace(/ /g, "-") ? "nav-active" : "nav-inactive"}`}>
              <I size={18}/>{n}
            </button>
          ))}</nav>
          <div className="mt-auto">
            <div className="rounded-2xl p-4 bg-gradient-to-br from-brand-400/10 to-brand-500/5 border border-brand-400/20">
              <div className="flex gap-2 text-brand-300 text-xs font-medium"><Sparkles size={15}/> RHoSAM AI Copilot</div>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">AI-powered demand forecasting, VIP recognition and service optimization.</p>
            </div>
          </div>
        </aside>

        {/* Mobile Sidebar */}
        {sidebarOpen && <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setSidebarOpen(false)}>
          <div className="h-full w-72 bg-navy-900 text-white p-5 overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between mb-8">
              <div className="flex items-center gap-2"><Crown size={18} className="text-brand-400"/><b className="text-white">RHoSAM HOTEL</b></div>
              <X onClick={() => setSidebarOpen(false)} className="cursor-pointer text-slate-400 hover:text-white"/>
            </div>
            {filteredNav.map(([n, I]) => <button key={n} onClick={() => navTo(n)} className={`w-full flex gap-3 p-3 rounded-xl hover:bg-white/10 text-sm ${active === n.toLowerCase().replace(/ & /g, "-").replace(/ /g, "-") ? "bg-brand-400/20 text-brand-300" : "text-slate-300"}`}><I size={18}/>{n}</button>)}
            <div className="mt-6 pt-4 border-t border-white/10">
              <button onClick={logout} className="w-full flex gap-3 p-3 rounded-xl hover:bg-white/10 text-slate-300 text-sm"><LogOut size={18}/> Sign Out</button>
            </div>
          </div>
        </div>}

        {/* Main Content */}
        <main className="lg:ml-64">
          <header className="h-16 px-4 md:px-8 flex items-center gap-4 sticky top-0 z-20 bg-[#f5f7fb]/80 dark:bg-navy-950/80 backdrop-blur-xl border-b border-slate-200/70 dark:border-slate-800">
            <button className="lg:hidden p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl" onClick={() => setSidebarOpen(true)}><Menu/></button>
            <div className="relative max-w-lg flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18}/>
              <input className="input pl-10 h-10" placeholder="Search guests, rooms, bookings…" value={searchQ} onChange={e => handleSearch(e.target.value)} onBlur={() => setTimeout(() => setSearchResults(null), 200)}/>
              {searchResults && <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-navy-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 max-h-80 overflow-y-auto z-50">
                {searchResults.guests?.length > 0 && <div className="p-3"><div className="text-xs font-medium text-slate-500 uppercase px-2 mb-2">Guests</div>{searchResults.guests.map(g => <button key={g.id} onClick={() => { navTo("guests"); setSearchResults(null); setSearchQ(""); }} className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-navy-900 text-left"><div className="h-8 w-8 rounded-lg bg-brand-100 text-brand-700 grid place-items-center text-xs font-bold">{g.first_name?.[0]}{g.last_name?.[0]}</div><div><div className="text-sm font-medium">{g.first_name} {g.last_name}</div><div className="text-xs text-slate-500">{g.loyalty_tier} · {g.total_stays} stays</div></div></button>)}</div>}
                {searchResults.rooms?.length > 0 && <div className="p-3 border-t border-slate-100 dark:border-slate-700"><div className="text-xs font-medium text-slate-500 uppercase px-2 mb-2">Rooms</div>{searchResults.rooms.map(r => <div key={r.id} className="flex items-center gap-3 p-2"><div className="text-sm font-medium">Room {r.number}</div><div className="text-xs text-slate-500">{r.type_name} · {r.status}</div></div>)}</div>}
                {searchResults.reservations?.length > 0 && <div className="p-3 border-t border-slate-100 dark:border-slate-700"><div className="text-xs font-medium text-slate-500 uppercase px-2 mb-2">Reservations</div>{searchResults.reservations.map(r => <div key={r.id} className="flex items-center gap-3 p-2"><div><div className="text-sm font-medium">{r.confirmation_number}</div><div className="text-xs text-slate-500">{r.guest_name} · Room {r.room_number || "—"}</div></div></div>)}</div>}
                {!searchResults.guests?.length && !searchResults.rooms?.length && !searchResults.reservations?.length && <div className="p-6 text-center text-sm text-slate-400">No results found</div>}
              </div>}
            </div>
            <StatusMonitor />
            <button className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition" onClick={() => setDark(!dark)}>{dark ? <Sun size={19}/> : <Moon size={19}/>}</button>
            <CurrencySelector />
            {/* Notification Bell + Dropdown */}
            <div className="relative">
              <button className="relative p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition" onClick={() => { setShowNotifPanel(!showNotifPanel); if (!showNotifPanel && unreadCount > 0) markNotificationsRead(); }}>
                <Bell size={19}/>
                {unreadCount > 0 && <span className="absolute -top-0.5 -right-0.5 h-5 w-5 bg-rose-500 text-white text-[9px] font-bold rounded-full grid place-items-center animate-pulse">{unreadCount > 9 ? "9+" : unreadCount}</span>}
              </button>
              {showNotifPanel && <>
                <div className="fixed inset-0 z-40" onClick={() => setShowNotifPanel(false)}/>
                <div className="absolute top-full right-0 mt-2 w-80 bg-white dark:bg-navy-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 z-50 max-h-[70vh] overflow-hidden">
                  <div className="p-4 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
                    <h3 className="font-semibold text-sm">Notifications</h3>
                    {unreadCount > 0 && <button className="text-xs text-brand-600 hover:underline" onClick={() => markNotificationsRead()}>Mark all read</button>}
                  </div>
                  <div className="overflow-y-auto max-h-[50vh]">
                    {notifications.length === 0 ? <div className="p-6 text-center text-slate-400 text-sm">No notifications yet</div> :
                      notifications.slice(0, 20).map(n => {
                        const typeColors = { ROOM_SERVICE: "bg-emerald-100 text-emerald-700", SPA: "bg-violet-100 text-violet-700", HOUSEKEEPING: "bg-sky-100 text-sky-700", MAINTENANCE: "bg-amber-100 text-amber-700", SECURITY: "bg-rose-100 text-rose-700", SHIFT: "bg-brand-100 text-brand-700" };
                        return <div key={n.id} className={`p-3 border-b border-slate-50 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition ${!n.is_read ? "bg-brand-50/30 dark:bg-brand-900/10" : ""}`}>
                          <div className="flex items-start gap-2">
                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0 mt-0.5 ${typeColors[n.type] || "bg-slate-100 text-slate-600"}`}>{n.type}</span>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-semibold">{n.title}</div>
                              <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{n.body}</div>
                              <div className="text-[10px] text-slate-400 mt-1">{new Date(n.created_at).toLocaleString()}</div>
                            </div>
                            {!n.is_read && <div className="h-2 w-2 rounded-full bg-brand-500 shrink-0 mt-1"/>}
                          </div>
                        </div>;
                      })}
                  </div>
                </div>
              </>}
            </div>
            <div className="hidden sm:flex items-center gap-3 border-l pl-4 border-slate-200 dark:border-slate-800">
              <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 text-navy-950 grid place-items-center text-sm font-bold shadow-sm">{user?.name?.split(" ").map(n=>n[0]).join("") || "A"}</div>
              <div className="leading-tight"><div className="text-sm font-medium">{user?.name || "Admin"}</div><div className="text-xs text-slate-500">{user?.role?.replace("_", " ")}</div></div>
            </div>
          </header>
          {/* Offline Banner */}
          {!navigator.onLine && (
            <div className="bg-amber-500 text-white text-center text-sm py-2 px-4 font-medium flex items-center justify-center gap-2">
              <WifiOff size={14} /> You are offline — some features may be unavailable
            </div>
          )}
          <div className="page">{children}</div>
        </main>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════════
function MetricCard({ icon: Icon, label, value, delta, accent, onClick }) {
  return <div className={`metric cursor-pointer transition hover:shadow-md ${onClick ? "hover:-translate-y-0.5" : ""}`} onClick={onClick}>
    <div className="flex items-start justify-between"><div className={`p-2.5 rounded-xl ${accent}`}><Icon size={20}/></div>{delta && <span className={`badge ${delta.startsWith("+") || delta === "Live" || delta === "On track" || delta === "Excellent" ? "badge-success" : "badge-info"}`}>{delta}</span>}</div>
    <div className="mt-4 text-2xl md:text-3xl font-semibold tracking-tight">{value}</div><div className="text-sm text-slate-500 mt-1">{label}</div>
  </div>;
}

function StatusBadge({ status }) {
  const colors = {
    AVAILABLE: "badge-success", OCCUPIED: "badge-violet", DIRTY: "badge-warning", CLEAN: "badge-success",
    INSPECTING: "badge-info", OUT_OF_ORDER: "badge-danger", PENDING: "badge-warning", CONFIRMED: "badge-info",
    CHECKED_IN: "badge-success", CHECKED_OUT: "badge-slate", CANCELLED: "badge-danger", NO_SHOW: "badge-danger",    IN_PROGRESS: "badge-info", COMPLETED: "badge-success", OPEN: "badge-warning", RESOLVED: "badge-success",
      SCHEDULED: "badge-info", INQUIRY: "badge-slate", DRAFT: "badge-slate",
    UNPAID: "badge-danger", PAID: "badge-success", PARTIAL: "badge-warning",
    URGENT: "badge-danger", HIGH: "badge-warning", NORMAL: "badge-info", LOW: "badge-slate",
    PLATINUM: "badge bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
    GOLD: "badge bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    SILVER: "badge bg-slate-200 text-slate-600 dark:bg-slate-600 dark:text-slate-200",
    BRONZE: "badge bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  };
  return <span className={colors[status] || "badge-slate"}>{(status || "").replace(/_/g, " ")}</span>;
}

function EmptyState({ icon: Icon, title, description }) {
  return <div className="empty-state"><Icon size={48} className="mb-4 text-slate-300 dark:text-slate-600"/><h3 className="text-lg font-semibold mb-1">{title}</h3><p className="text-sm max-w-md text-center">{description}</p></div>;
}

function PageHeader({ title, subtitle, actions }) {
  return <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
    <div><h1 className="section-title">{title}</h1>{subtitle && <p className="section-sub mt-1">{subtitle}</p>}</div>
    {actions && <div className="flex gap-2 flex-wrap">{actions}</div>}
  </div>;
}

// ═══════════════════════════════════════════════════════════════════
// LOGIN PAGE
// ═══════════════════════════════════════════════════════════════════
function LoginPage() {
  const { login } = useAuth(); const navigate = useNavigate();
  const [email, setEmail] = useState("admin@rhosamhotel.com");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault(); setError(""); setBusy(true);
    try { await login(email, password); navigate("/overview"); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-navy-950 via-navy-900 to-navy-950 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 opacity-5"><div className="absolute top-20 left-20 h-96 w-96 rounded-full bg-brand-400 blur-3xl"/><div className="absolute bottom-20 right-20 h-72 w-72 rounded-full bg-brand-300 blur-3xl"/></div>
      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-brand-300 to-brand-500 grid place-items-center text-navy-950 mx-auto mb-5 shadow-2xl shadow-brand-400/30"><Crown size={40}/></div>
          <h1 className="text-4xl font-bold text-white tracking-tight">RHoSAM Hotel</h1>
          <p className="text-brand-300 text-sm mt-2 tracking-[.3em] font-medium">HOTEL & SUITES</p>
          <p className="text-slate-400 text-sm mt-4">Premium Hotel Management Platform</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-navy-900/80 backdrop-blur-xl rounded-2xl p-8 border border-white/10 shadow-2xl">
          {error && <div className="bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm p-3 rounded-xl mb-4 flex items-center gap-2"><AlertTriangle size={16}/>{error}</div>}
          <div className="space-y-4">
            <div><label className="text-sm text-slate-400 mb-1.5 block">Email Address</label><input type="email" className="input bg-navy-950/80 border-slate-700 text-white" value={email} onChange={e => setEmail(e.target.value)} required /></div>
            <div><label className="text-sm text-slate-400 mb-1.5 block">Password</label><input type="password" className="input bg-navy-950/80 border-slate-700 text-white" value={password} onChange={e => setPassword(e.target.value)} required /></div>
          </div>
          <button type="submit" disabled={busy} className="w-full mt-6 h-12 rounded-xl bg-gradient-to-r from-brand-400 to-brand-500 hover:from-brand-300 hover:to-brand-400 text-navy-950 font-semibold text-sm transition disabled:opacity-50 shadow-lg shadow-brand-400/20">
            {busy ? "Signing in…" : "Sign In to Command Centre"}
          </button>
          <div className="mt-4 p-3 rounded-xl bg-navy-950/50 border border-slate-700/50">
            <p className="text-xs text-slate-500 text-center">Demo: admin@rhosamhotel.com / admin123</p>
          </div>
        </form>
        <p className="text-center text-slate-500 text-xs mt-6 flex items-center justify-center gap-2"><ShieldCheck size={14}/> Secure, auditable, role-based access · RHoSAM Hotel OS v1.0</p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// OVERVIEW / DASHBOARD
// ═══════════════════════════════════════════════════════════════════
function OverviewPage() {
  const { fetchDashboard, user } = useAuth();
  const [data, setData] = useState(null); const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => { fetchDashboard().then(setData).catch(() => {}).finally(() => setLoading(false)); }, [fetchDashboard]);

  const greeting = useMemo(() => { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="text-slate-500 flex items-center gap-2"><div className="h-5 w-5 border-2 border-brand-400 border-t-transparent rounded-full animate-spin"/> Loading dashboard…</div></div>;
  if (!data) return <EmptyState icon={AlertTriangle} title="Failed to load dashboard" description="Please try refreshing the page."/>;

  const occ = data.occupancy || { total: 0, occupied: 0, rate: 0 };
  const rooms = data.recentReservations || [];

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-7">
        <div>
          <div className="flex items-center gap-2 text-sm text-brand-600 font-medium mb-1"><Star size={16} fill="currentColor"/> Five-star command centre</div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">{greeting}, {user?.name?.split(" ")[0] || "Admin"}</h1>
          <p className="text-slate-500 mt-1">Here is the live pulse of RHoSAM Hotel & Suites.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary"><FileText size={16}/> Export</button>
          <button className="btn-primary" onClick={() => navigate("/reservations")}><Plus size={16}/> New Reservation</button>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard icon={BedDouble} label="Occupancy" value={`${occ.rate}%`} delta={`${occ.occupied}/${occ.total}`} accent="bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400" onClick={() => navigate("/rooms")}/>
        <MetricCard icon={CircleDollarSign} label="Revenue today" value={`₦${(data.revenue?.today || 0).toLocaleString()}`} delta="Live" accent="bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400" onClick={() => navigate("/finance")}/>
        <MetricCard icon={LogOut} label="Arrivals / Departures" value={`${data.arrivals || 0} / ${data.departures || 0}`} delta="On track" accent="bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400" onClick={() => navigate("/front-desk")}/>
        <MetricCard icon={Star} label="Guest Satisfaction" value={data.satisfaction?.toFixed(1) || "4.8"} delta="Excellent" accent="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"/>
      </div>

      {/* Revenue Chart + Next VIP */}
      <div className="grid xl:grid-cols-3 gap-5 mt-5">
        <div className="xl:col-span-2 card"><div className="p-5 md:p-6">
          <div className="flex items-center justify-between mb-6"><div><h2 className="font-semibold text-lg">Revenue pulse</h2><p className="text-xs text-slate-500">Rooms, dining, spa and events</p></div></div>
          <div className="h-64"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.revenueChart || []}>
            <defs><linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d97706" stopOpacity={0.35}/><stop offset="1" stopColor="#d97706" stopOpacity={0}/></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0"/><XAxis dataKey="date" axisLine={false} tickLine={false}/><YAxis hide/><Tooltip contentStyle={{ borderRadius: 14, border: 0, boxShadow: "0 10px 30px #0001" }}/>
            <Area type="monotone" dataKey="revenue" stroke="#d97706" strokeWidth={3} fill="url(#gold)" name="Revenue (₦K)"/>
          </AreaChart></ResponsiveContainer></div>
        </div></div>
        <div className="card bg-gradient-to-br from-navy-900 to-navy-800 text-white overflow-hidden"><div className="p-6">
          <div className="flex justify-between">
            <div><div className="text-brand-300 text-sm flex gap-2 items-center"><Crown size={16}/> Royal arrival</div>
              <h2 className="font-semibold text-xl mt-3">{rooms[0]?.guest_name || "No upcoming"}</h2>
              <p className="text-sm text-slate-400">{rooms[0]?.is_vip ? "VIP Guest" : "Next arrival"}</p>
            </div>
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 text-navy-950 grid place-items-center text-sm font-bold">{rooms[0]?.guest_name?.split(" ").map(n=>n[0]).join("") || "?"}</div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-7 text-sm">
            <div className="bg-white/5 rounded-xl p-3"><div className="text-slate-400 text-xs">Room</div><b>{rooms[0]?.room_number || "—"}</b></div>
            <div className="bg-white/5 rounded-xl p-3"><div className="text-slate-400 text-xs">Check-in</div><b>{rooms[0]?.check_in || "—"}</b></div>
          </div>
          <div className="mt-4 p-3 rounded-xl border border-brand-300/20 bg-brand-300/5 text-xs text-slate-300">{rooms[0]?.special_requests || "No special requests recorded."}</div>
          <button className="mt-4 w-full btn bg-brand-400 hover:bg-brand-300 text-navy-950 rounded-xl h-10 text-sm font-medium" onClick={() => navigate("/reservations")}>View Experience Plan <ArrowUpRight size={16} className="ml-1"/></button>
        </div></div>
      </div>

      {/* Room Operations + Activity */}
      <div className="grid xl:grid-cols-3 gap-5 mt-5">
        <div className="xl:col-span-2 card"><div className="p-0">
          <div className="p-5 md:p-6 flex justify-between items-center"><div><h2 className="font-semibold text-lg">Live room operations</h2><p className="text-xs text-slate-500">Prioritized by guest and operational impact</p></div>
            <button className="btn-ghost btn-sm" onClick={() => navigate("/rooms")}>View all <ArrowUpRight size={14}/></button>
          </div>
          <div className="table-wrap"><table><thead><tr><th>ROOM</th><th>GUEST</th><th>DATES</th><th>STATUS</th><th>AMOUNT</th></tr></thead>
            <tbody>{rooms.map(r => <tr key={r.id} className="cursor-pointer" onClick={() => navigate("/reservations")}>
              <td className="font-semibold">{r.room_number || "—"}</td><td className="text-slate-500">{r.guest_name || "—"}</td>
              <td className="text-xs">{r.check_in} → {r.check_out}</td>
              <td><StatusBadge status={r.status}/></td><td className="font-semibold">₦{Number(r.total_amount || 0).toLocaleString()}</td>
            </tr>)}
              {!rooms.length && <tr><td colSpan={5} className="text-center py-8 text-slate-400">No recent reservations</td></tr>}
            </tbody></table></div>
        </div></div>

        <div className="card"><div className="p-5 md:p-6">
          <h2 className="font-semibold text-lg mb-4">Operations at a Glance</h2>
          <div className="space-y-3">
            {[{ t: "Housekeeping", v: `${Math.round(((data.roomStatuses?.CLEAN || 0) / Math.max(occ.total, 1)) * 100)}%`, s: `${data.roomStatuses?.CLEAN || 0} rooms clean`, i: ClipboardCheck, c: "text-emerald-600" },
              { t: "Open Maintenance", v: data.openMaintenance || 0, s: `${data.openMaintenance || 0} work orders`, i: Wrench, c: "text-amber-600" },
              { t: "Guest Requests", v: data.pendingGuestRequests || 0, s: `${data.pendingGuestRequests || 0} pending`, i: MessageSquareText, c: "text-sky-600" },
              { t: "Active Events", v: data.activeEvents || 0, s: `${data.activeEvents || 0} today`, i: PartyPopper, c: "text-violet-600" },
              { t: "Housekeeping Tasks", v: data.pendingTasks || 0, s: `${data.pendingTasks || 0} in progress`, i: Clock3, c: "text-rose-600" },
            ].map(x => (
              <div key={x.t} className="p-3 rounded-xl bg-slate-50 dark:bg-navy-950/50 flex justify-between items-center">
                <div className="flex gap-2 items-center text-sm"><x.i size={17} className={x.c}/><span className="font-medium">{x.t}</span></div>
                <div className="text-right"><div className="font-bold">{x.v}</div><div className="text-xs text-slate-500">{x.s}</div></div>
              </div>
            ))}
          </div>
        </div></div>
      </div>

      {/* Room Status Grid */}
      <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-5">
        {Object.entries(data.roomStatuses || {}).map(([status, count]) => (
          <div key={status} className="card p-4 text-center hover:shadow-md transition cursor-pointer" onClick={() => navigate("/rooms")}>
            <StatusBadge status={status}/>
            <div className="text-2xl font-bold mt-2">{count}</div>
            <div className="text-xs text-slate-500">rooms</div>
          </div>
        ))}
      </div>

      <footer className="mt-8 flex flex-col sm:flex-row gap-2 justify-between text-xs text-slate-400">
        <span>RHoSAM Hotel & Suites OS v1.0 · Live operational platform</span>
        <span className="flex gap-2 items-center"><ShieldCheck size={14}/> Secure, auditable, role-based access</span>
      </footer>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// RESERVATIONS PAGE
// ═══════════════════════════════════════════════════════════════════
function ReservationsPage() {
  const auth = useAuth();
  const [reservations, setReservations] = useState([]); const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(""); const [showForm, setShowForm] = useState(false);
  const [guests, setGuests] = useState([]); const [roomTypes, setRoomTypes] = useState([]);
  const [form, setForm] = useState({ guestId: "", roomTypeId: "", checkIn: "", checkOut: "", adults: 1, children: 0, rate: "", specialRequests: "", source: "DIRECT", isVip: false });
  const [newGuest, setNewGuest] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  const [createGuestMode, setCreateGuestMode] = useState(false);
  const [msg, setMsg] = useState(""); const [detailRes, setDetailRes] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const params = filter ? { status: filter } : undefined; setReservations(await auth.fetchReservations(params)); } catch {} finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { auth.fetchGuests().then(setGuests).catch(() => {}); auth.fetchRoomTypes().then(setRoomTypes).catch(() => {}); }, []);

  async function handleCreate(e) {
    e.preventDefault(); setMsg("");
    try {
      let guestId = form.guestId;
      if (createGuestMode && newGuest.firstName && newGuest.lastName) {
        const g = await auth.createGuest(newGuest); guestId = g.id;
      }
      if (!guestId) { setMsg("Error: Please select or create a guest."); return; }
      await auth.createReservation({ guestId: Number(guestId), roomTypeId: form.roomTypeId ? Number(form.roomTypeId) : null, checkIn: form.checkIn, checkOut: form.checkOut, adults: Number(form.adults), children: Number(form.children), rate: form.rate ? Number(form.rate) : null, specialRequests: form.specialRequests, source: form.source, isVip: form.isVip });
      setShowForm(false); setMsg("Reservation created successfully!"); load(); auth.notifyDataChange();
    } catch (err) { setMsg(`Error: ${err.message}`); }
  }

  async function handleStatusChange(id, status) {
    try { await auth.updateReservationStatus(id, status); load(); auth.notifyDataChange(); } catch (err) { alert(err.message); }
  }

  async function viewDetail(id) { try { setDetailRes(await auth.fetchReservation(id)); } catch { alert("Failed to load reservation."); } }

  return (
    <div>
      <PageHeader title="Reservations" subtitle="Manage bookings, arrivals and guest stays" actions={
        <>
          <select className="select h-10 w-40" value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="">All Status</option>
            {["PENDING", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "CANCELLED", "NO_SHOW"].map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </select>
          <button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={17}/> New Reservation</button>
        </>
      }/>

      {msg && <div className={`p-3 rounded-xl mb-4 text-sm flex items-center gap-2 ${msg.startsWith("Error") ? "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"}`}>{msg.startsWith("Error") ? <XCircle size={16}/> : <CheckCircle2 size={16}/>}{msg}</div>}

      <div className="card"><div className="table-wrap"><table>
        <thead><tr><th>CONFIRMATION</th><th>GUEST</th><th>ROOM</th><th>CHECK-IN</th><th>CHECK-OUT</th><th>NIGHTS</th><th>AMOUNT</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
        <tbody>{loading ? <tr><td colSpan={9} className="text-center py-8 text-slate-400">Loading…</td></tr> :
          reservations.map(r => <tr key={r.id}>
            <td className="font-semibold font-mono text-xs">{r.confirmation_number}</td>
            <td><div className="flex items-center gap-2">{r.is_vip && <Crown size={14} className="text-brand-500"/>}{r.guest_name || "—"}</div></td>
            <td>{r.room_number || "—"}</td>
            <td className="text-xs">{r.check_in}</td><td className="text-xs">{r.check_out}</td>
            <td className="text-xs">{Math.ceil((new Date(r.check_out) - new Date(r.check_in)) / 86400000)}</td>
            <td className="font-semibold">₦{Number(r.total_amount || 0).toLocaleString()}</td>
            <td><StatusBadge status={r.status}/></td>
            <td><div className="flex gap-1">
              <button className="btn-ghost btn-sm" onClick={() => viewDetail(r.id)}><Eye size={14}/></button>
              {r.status === "CONFIRMED" && <button className="btn-success btn-sm" onClick={() => handleStatusChange(r.id, "CHECKED_IN")}><Check size={14}/> In</button>}
              {r.status === "CHECKED_IN" && <button className="btn-primary btn-sm" onClick={() => handleStatusChange(r.id, "CHECKED_OUT")}><LogOut size={14}/> Out</button>}
              {r.status === "PENDING" && <button className="btn-secondary btn-sm" onClick={() => handleStatusChange(r.id, "CONFIRMED")}><Check size={14}/></button>}
            </div></td>
          </tr>)}
          {!loading && !reservations.length && <tr><td colSpan={9} className="text-center py-12 text-slate-400">No reservations found</td></tr>}
        </tbody></table></div></div>

      {/* Create Modal */}
      {showForm && <div className="modal-overlay" onClick={() => setShowForm(false)}>
        <div className="modal-content max-w-lg p-6" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-5"><h2 className="text-xl font-semibold">New Reservation</h2><button className="btn-ghost btn-icon btn-sm" onClick={() => setShowForm(false)}><X size={18}/></button></div>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="flex gap-2 mb-2">
              <button type="button" className={`btn btn-sm ${!createGuestMode ? "bg-navy-900 text-white dark:bg-brand-400 dark:text-navy-950" : "bg-slate-100 dark:bg-slate-800"}`} onClick={() => setCreateGuestMode(false)}>Select Guest</button>
              <button type="button" className={`btn btn-sm ${createGuestMode ? "bg-navy-900 text-white dark:bg-brand-400 dark:text-navy-950" : "bg-slate-100 dark:bg-slate-800"}`} onClick={() => setCreateGuestMode(true)}>Create Guest</button>
            </div>
            {!createGuestMode ? (
              <div><label className="text-sm text-slate-500 mb-1 block">Guest</label><select className="select" value={form.guestId} onChange={e => setForm({ ...form, guestId: e.target.value })} required><option value="">Select guest…</option>{guests.map(g => <option key={g.id} value={g.id}>{g.first_name} {g.last_name} ({g.loyalty_tier})</option>)}</select></div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-sm text-slate-500 mb-1 block">First Name</label><input className="input" value={newGuest.firstName} onChange={e => setNewGuest({ ...newGuest, firstName: e.target.value })} required/></div>
                <div><label className="text-sm text-slate-500 mb-1 block">Last Name</label><input className="input" value={newGuest.lastName} onChange={e => setNewGuest({ ...newGuest, lastName: e.target.value })} required/></div>
                <div><label className="text-sm text-slate-500 mb-1 block">Email</label><input className="input" type="email" value={newGuest.email} onChange={e => setNewGuest({ ...newGuest, email: e.target.value })}/></div>
                <div><label className="text-sm text-slate-500 mb-1 block">Phone</label><input className="input" value={newGuest.phone} onChange={e => setNewGuest({ ...newGuest, phone: e.target.value })}/></div>
              </div>
            )}
            <div><label className="text-sm text-slate-500 mb-1 block">Room Type</label><select className="select" value={form.roomTypeId} onChange={e => setForm({ ...form, roomTypeId: e.target.value })}><option value="">Auto-assign best available</option>{roomTypes.map(rt => <option key={rt.id} value={rt.id}>{rt.name} — ₦{Number(rt.base_rate).toLocaleString()}/night</option>)}</select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-sm text-slate-500 mb-1 block">Check-in</label><input type="date" className="input" value={form.checkIn} onChange={e => setForm({ ...form, checkIn: e.target.value })} required/></div>
              <div><label className="text-sm text-slate-500 mb-1 block">Check-out</label><input type="date" className="input" value={form.checkOut} onChange={e => setForm({ ...form, checkOut: e.target.value })} required/></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className="text-sm text-slate-500 mb-1 block">Adults</label><input type="number" min="1" className="input" value={form.adults} onChange={e => setForm({ ...form, adults: e.target.value })}/></div>
              <div><label className="text-sm text-slate-500 mb-1 block">Children</label><input type="number" min="0" className="input" value={form.children} onChange={e => setForm({ ...form, children: e.target.value })}/></div>
              <div><label className="text-sm text-slate-500 mb-1 block">Rate (₦/night)</label><input type="number" className="input" placeholder="Auto" value={form.rate} onChange={e => setForm({ ...form, rate: e.target.value })}/></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-sm text-slate-500 mb-1 block">Source</label><select className="select" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })}>{["DIRECT", "BOOKING_COM", "EXPEDIA", "AIRBNB", "CORPORATE", "TRAVEL_AGENT"].map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select></div>
              <div className="flex items-end pb-1"><label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.isVip} onChange={e => setForm({ ...form, isVip: e.target.checked })} className="rounded"/><span className="text-sm">VIP Guest</span></label></div>
            </div>
            <div><label className="text-sm text-slate-500 mb-1 block">Special Requests</label><textarea className="input h-20 resize-none" value={form.specialRequests} onChange={e => setForm({ ...form, specialRequests: e.target.value })}/></div>
            <div className="flex gap-2 pt-2"><button type="button" className="btn-secondary flex-1" onClick={() => setShowForm(false)}>Cancel</button><button type="submit" className="btn-primary flex-1">Create Reservation</button></div>
          </form>
        </div>
      </div>}

      {/* Detail Modal */}
      {detailRes && <div className="modal-overlay" onClick={() => setDetailRes(null)}>
        <div className="modal-content max-w-lg p-6" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-5">
            <div><h2 className="text-xl font-semibold">{detailRes.confirmation_number}</h2><p className="text-slate-500 text-sm">{detailRes.guest_name} · {detailRes.is_vip && <span className="text-brand-500 font-medium">VIP</span>}</p></div>
            <StatusBadge status={detailRes.status}/>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="card p-3"><div className="text-xs text-slate-500">Room</div><div className="font-semibold">{detailRes.room_number || "Unassigned"} · {detailRes.type_name || "—"}</div></div>
            <div className="card p-3"><div className="text-xs text-slate-500">Amount</div><div className="font-semibold">₦{Number(detailRes.total_amount || 0).toLocaleString()}</div></div>
            <div className="card p-3"><div className="text-xs text-slate-500">Check-in</div><div className="font-semibold">{detailRes.check_in}</div></div>
            <div className="card p-3"><div className="text-xs text-slate-500">Check-out</div><div className="font-semibold">{detailRes.check_out}</div></div>
          </div>
          {detailRes.special_requests && <div className="p-3 rounded-xl bg-brand-50 dark:bg-brand-900/10 border border-brand-200 dark:border-brand-800 text-sm mb-4"><b>Special Requests:</b> {detailRes.special_requests}</div>}
          {detailRes.folioItems?.length > 0 && <div className="mt-4"><h3 className="font-semibold text-sm mb-2">Folio Items</h3><div className="space-y-2">{detailRes.folioItems.map(fi => <div key={fi.id} className="flex justify-between items-center p-2 rounded-lg bg-slate-50 dark:bg-navy-900 text-sm">
            <div><div className="font-medium">{fi.description}</div><div className="text-xs text-slate-500">{fi.category}</div></div>
            <div className={`font-semibold ${fi.amount < 0 ? "text-emerald-600" : ""}`}>{fi.amount < 0 ? "-" : ""}₦{Math.abs(Number(fi.amount)).toLocaleString()}</div>
          </div>)}</div></div>}
          <button className="btn-secondary w-full mt-4" onClick={() => setDetailRes(null)}>Close</button>
        </div>
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// FRONT DESK PAGE
// ═══════════════════════════════════════════════════════════════════
function FrontDeskPage() {
  const auth = useAuth();
  const [arrivals, setArrivals] = useState([]); const [departures, setDepartures] = useState([]);
  const [loading, setLoading] = useState(true);
  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await auth.fetchReservations();
      setArrivals(all.filter(r => r.check_in === today && ["PENDING", "CONFIRMED"].includes(r.status)));
      setDepartures(all.filter(r => r.check_out === today && r.status === "CHECKED_IN"));
    } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function handleCheckIn(id) { try { await auth.updateReservationStatus(id, "CHECKED_IN"); load(); auth.notifyDataChange(); } catch (err) { alert(err.message); } }
  async function handleCheckOut(id) { try { await auth.updateReservationStatus(id, "CHECKED_OUT"); load(); auth.notifyDataChange(); } catch (err) { alert(err.message); } }

  return (
    <div>
      <PageHeader title="Front Desk" subtitle={`Today's arrivals and departures — ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`}/>
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="card"><div className="p-5 border-b border-slate-100 dark:border-slate-700/50 flex justify-between items-center">
          <h2 className="font-semibold flex items-center gap-2"><KeyRound size={18} className="text-emerald-600"/> Arrivals ({arrivals.length})</h2>
        </div><div className="divide-y divide-slate-100 dark:divide-slate-700/50">
          {arrivals.map(r => <div key={r.id} className="p-4 flex justify-between items-center hover:bg-slate-50/60 dark:hover:bg-navy-900/50 transition">
            <div><div className="font-medium flex items-center gap-2">{r.is_vip && <Crown size={14} className="text-brand-500"/>}{r.guest_name || "—"}</div>
              <div className="text-sm text-slate-500">{r.room_number || "Unassigned"} · {r.type_name || "—"}</div>
              <div className="text-xs text-slate-400 mt-1">{r.confirmation_number} · {r.adults} adult(s) · {r.children} child(ren)</div>
              {r.special_requests && <div className="text-xs text-brand-600 mt-1 italic">"{r.special_requests}"</div>}
            </div>
            <div className="flex gap-2">{r.status === "CONFIRMED" && <button className="btn-success btn-sm" onClick={() => handleCheckIn(r.id)}><Check size={14}/> Check In</button>}
              {r.status === "PENDING" && <button className="btn-secondary btn-sm" onClick={() => handleCheckIn(r.id)}><Check size={14}/> Confirm & In</button>}
            </div>
          </div>)}
          {!arrivals.length && <div className="p-8 text-center text-slate-400 text-sm">No arrivals today</div>}
        </div></div>

        <div className="card"><div className="p-5 border-b border-slate-100 dark:border-slate-700/50 flex justify-between items-center">
          <h2 className="font-semibold flex items-center gap-2"><LogOut size={18} className="text-sky-600"/> Departures ({departures.length})</h2>
        </div><div className="divide-y divide-slate-100 dark:divide-slate-700/50">
          {departures.map(r => <div key={r.id} className="p-4 flex justify-between items-center hover:bg-slate-50/60 dark:hover:bg-navy-900/50 transition">
            <div><div className="font-medium">{r.guest_name || "—"}</div><div className="text-sm text-slate-500">Room {r.room_number || "—"}</div>
              <div className="text-xs text-slate-400 mt-1">Total: ₦{Number(r.total_amount || 0).toLocaleString()}</div>
            </div>
            <button className="btn-primary btn-sm" onClick={() => handleCheckOut(r.id)}><LogOut size={14}/> Check Out</button>
          </div>)}
          {!departures.length && <div className="p-8 text-center text-slate-400 text-sm">No departures today</div>}
        </div></div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ROOMS PAGE
// ═══════════════════════════════════════════════════════════════════
function RoomsPage() {
  const auth = useAuth();
  const [rooms, setRooms] = useState([]); const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(""); const [floorFilter, setFloorFilter] = useState("");
  const [viewMode, setViewMode] = useState("grid");

  const load = useCallback(async () => {
    setLoading(true);
    try { const params = {}; if (statusFilter) params.status = statusFilter; if (floorFilter) params.floor = floorFilter; setRooms(await auth.fetchRooms(Object.keys(params).length ? params : undefined)); } catch {} finally { setLoading(false); }
  }, [statusFilter, floorFilter]);
  useEffect(() => { load(); }, [load]);

  async function handleChangeStatus(id, status) {
    try { await auth.updateRoomStatus(id, { status }); load(); auth.notifyDataChange(); } catch (err) { alert(err.message); }
  }

  const nextStatus = { AVAILABLE: "OUT_OF_ORDER", OCCUPIED: "DIRTY", DIRTY: "CLEAN", CLEAN: "INSPECTING", INSPECTING: "AVAILABLE" };
  const floors = [...new Set(rooms.map(r => r.floor))].sort((a, b) => a - b);
  const summary = rooms.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});

  const statusColorMap = { AVAILABLE: "bg-emerald-500", OCCUPIED: "bg-violet-500", DIRTY: "bg-amber-500", CLEAN: "bg-sky-500", INSPECTING: "bg-blue-500", OUT_OF_ORDER: "bg-rose-500" };

  return (
    <div>
      <PageHeader title="Room Management" subtitle={`${rooms.length} rooms across ${floors.length} floors`} actions={
        <div className="flex gap-2">
          <button className={`btn-sm btn ${viewMode === "grid" ? "bg-navy-900 text-white dark:bg-brand-400 dark:text-navy-950" : "btn-secondary"}`} onClick={() => setViewMode("grid")}>Grid</button>
          <button className={`btn-sm btn ${viewMode === "table" ? "bg-navy-900 text-white dark:bg-brand-400 dark:text-navy-950" : "btn-secondary"}`} onClick={() => setViewMode("table")}>Table</button>
          <select className="select h-10 w-36" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">All Status</option>{["AVAILABLE","OCCUPIED","DIRTY","CLEAN","INSPECTING","OUT_OF_ORDER"].map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select>
          <select className="select h-10 w-32" value={floorFilter} onChange={e => setFloorFilter(e.target.value)}><option value="">All Floors</option>{floors.map(f => <option key={f} value={f}>Floor {f}</option>)}</select>
        </div>
      }/>

      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-6">
        {Object.entries(summary).map(([s, c]) => <div key={s} className="card p-3 text-center hover:shadow-md transition cursor-pointer" onClick={() => setStatusFilter(s === statusFilter ? "" : s)}>
          <div className={`h-2 w-2 rounded-full mx-auto mb-2 ${statusColorMap[s] || "bg-slate-400"}`}/>
          <span className="text-xs font-medium">{s.replace("_", " ")}</span>
          <div className="text-xl font-bold mt-1">{c}</div>
        </div>)}
      </div>

      {viewMode === "grid" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {rooms.map(r => <div key={r.id} className="card p-4 hover:shadow-md transition cursor-pointer">
            <div className="flex items-center justify-between mb-3">
              <div className="font-bold text-lg">{r.number}</div>
              <div className={`h-3 w-3 rounded-full ${statusColorMap[r.status] || "bg-slate-400"}`}/>
            </div>
            <div className="text-sm text-slate-500 mb-1">{r.type_name || "—"}</div>
            <div className="text-xs text-slate-400 mb-3">Floor {r.floor} · ₦{Number(r.base_rate || 0).toLocaleString()}/night</div>
            <StatusBadge status={r.status}/>
            {nextStatus[r.status] && <button className="btn-secondary btn-sm w-full mt-3 text-xs" onClick={(e) => { e.stopPropagation(); handleChangeStatus(r.id, nextStatus[r.status]); }}>→ {nextStatus[r.status].replace("_", " ")}</button>}
          </div>)}
        </div>
      ) : (
        <div className="card"><div className="table-wrap"><table>
          <thead><tr><th>ROOM</th><th>FLOOR</th><th>TYPE</th><th>RATE/NIGHT</th><th>STATUS</th><th>ACTION</th></tr></thead>
          <tbody>{rooms.map(r => <tr key={r.id}>
            <td className="font-semibold">{r.number}</td><td>{r.floor}</td><td>{r.type_name || "—"}</td>
            <td>₦{Number(r.base_rate || 0).toLocaleString()}</td>
            <td><StatusBadge status={r.status}/></td>
            <td>{nextStatus[r.status] && <button className="btn-secondary btn-sm" onClick={() => handleChangeStatus(r.id, nextStatus[r.status])}>→ {nextStatus[r.status].replace("_", " ")}</button>}</td>
          </tr>)}</tbody></table></div></div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// GUESTS PAGE
// ═══════════════════════════════════════════════════════════════════
function GuestsPage() {
  const auth = useAuth();
  const [guests, setGuests] = useState([]); const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(""); const [showForm, setShowForm] = useState(false);
  const [selectedGuest, setSelectedGuest] = useState(null);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", nationality: "", idType: "", idNumber: "", notes: "" });
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { setGuests(await auth.fetchGuests(search || undefined)); } catch {} finally { setLoading(false); }
  }, [search]);
  useEffect(() => { load(); }, [load]);

  async function handleCreate(e) {
    e.preventDefault(); setMsg("");
    try { await auth.createGuest(form); setShowForm(false); setForm({ firstName: "", lastName: "", email: "", phone: "", nationality: "", idType: "", idNumber: "", notes: "" }); setMsg("Guest created!"); load(); auth.notifyDataChange(); }
    catch (err) { setMsg(`Error: ${err.message}`); }
  }

  async function viewGuest(id) { try { setSelectedGuest(await auth.fetchGuest(id)); } catch { alert("Failed to load guest."); } }

  return (
    <div>
      <PageHeader title="Guests & CRM" subtitle={`${guests.length} guests in the system`} actions={
        <div className="flex gap-2">
          <input className="input h-10 w-64" placeholder="Search guests…" value={search} onChange={e => setSearch(e.target.value)}/>
          <button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={17}/> Add Guest</button>
        </div>
      }/>

      {msg && <div className={`p-3 rounded-xl mb-4 text-sm flex items-center gap-2 ${msg.startsWith("Error") ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{msg.startsWith("Error") ? <XCircle size={16}/> : <CheckCircle2 size={16}/>}{msg}</div>}

      <div className="card"><div className="table-wrap"><table>
        <thead><tr><th>GUEST</th><th>EMAIL</th><th>PHONE</th><th>NATIONALITY</th><th>STAYS</th><th>SPENT</th><th>TIER</th><th></th></tr></thead>
        <tbody>{loading ? <tr><td colSpan={8} className="text-center py-8 text-slate-400">Loading…</td></tr> :
          guests.map(g => <tr key={g.id}>
            <td><div className="flex items-center gap-3"><div className="h-9 w-9 rounded-xl bg-gradient-to-br from-brand-100 to-brand-200 text-brand-700 grid place-items-center text-xs font-bold">{g.first_name?.[0]}{g.last_name?.[0]}</div><div><div className="font-medium">{g.first_name} {g.last_name}</div></div></div></td>
            <td className="text-slate-500 text-sm">{g.email || "—"}</td><td className="text-sm">{g.phone || "—"}</td><td className="text-sm">{g.nationality || "—"}</td>
            <td className="font-semibold">{g.total_stays}</td><td className="font-semibold">₦{Number(g.total_spent || 0).toLocaleString()}</td>
            <td><StatusBadge status={g.loyalty_tier}/></td>
            <td><button className="btn-ghost btn-sm" onClick={() => viewGuest(g.id)}><Eye size={16}/></button></td>
          </tr>)}
        </tbody></table></div></div>

      {/* Guest Detail Modal */}
      {selectedGuest && <div className="modal-overlay" onClick={() => setSelectedGuest(null)}>
        <div className="modal-content max-w-lg p-6" onClick={e => e.stopPropagation()}>
          <div className="flex justify-between items-start mb-4">
            <div className="flex items-center gap-3"><div className="h-12 w-12 rounded-xl bg-gradient-to-br from-brand-400 to-brand-500 text-navy-950 grid place-items-center font-bold">{selectedGuest.first_name?.[0]}{selectedGuest.last_name?.[0]}</div>
              <div><h2 className="text-xl font-semibold">{selectedGuest.first_name} {selectedGuest.last_name}</h2><p className="text-slate-500 text-sm">{selectedGuest.email} · {selectedGuest.phone || "No phone"}</p></div>
            </div>
            <StatusBadge status={selectedGuest.loyalty_tier}/>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="card p-3 text-center"><div className="text-xl font-bold">{selectedGuest.total_stays}</div><div className="text-xs text-slate-500">Total Stays</div></div>
            <div className="card p-3 text-center"><div className="text-xl font-bold">₦{Number(selectedGuest.total_spent || 0).toLocaleString()}</div><div className="text-xs text-slate-500">Total Spent</div></div>
            <div className="card p-3 text-center"><div className="text-xl font-bold">{selectedGuest.loyalty_points || 0}</div><div className="text-xs text-slate-500">Points</div></div>
          </div>
          {selectedGuest.nationality && <div className="text-sm text-slate-500 mb-3 flex items-center gap-2"><Globe size={14}/> {selectedGuest.nationality}</div>}
          {selectedGuest.allergies && <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-900/10 text-sm mb-3"><b>Allergies:</b> {selectedGuest.allergies}</div>}
          {selectedGuest.stays?.length > 0 && <div><h3 className="font-semibold text-sm mb-2">Stay History</h3><div className="space-y-2 max-h-48 overflow-y-auto">{selectedGuest.stays.map(s => <div key={s.id} className="card p-3 flex justify-between items-center text-sm">
            <div><div className="font-medium">{s.room_number || "—"} · {s.type_name || "—"}</div><div className="text-slate-500 text-xs">{s.check_in} → {s.check_out}</div></div>
            <StatusBadge status={s.status}/>
          </div>)}</div></div>}
          <button className="btn-secondary w-full mt-4" onClick={() => setSelectedGuest(null)}>Close</button>
        </div>
      </div>}

      {/* Create Modal */}
      {showForm && <div className="modal-overlay" onClick={() => setShowForm(false)}>
        <div className="modal-content max-w-lg p-6" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-5"><h2 className="text-xl font-semibold">Add Guest</h2><button className="btn-ghost btn-icon btn-sm" onClick={() => setShowForm(false)}><X size={18}/></button></div>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3"><div><label className="text-sm text-slate-500">First Name</label><input className="input" value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} required/></div><div><label className="text-sm text-slate-500">Last Name</label><input className="input" value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} required/></div></div>
            <div className="grid grid-cols-2 gap-3"><div><label className="text-sm text-slate-500">Email</label><input className="input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}/></div><div><label className="text-sm text-slate-500">Phone</label><input className="input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}/></div></div>
            <div className="grid grid-cols-3 gap-3"><div><label className="text-sm text-slate-500">Nationality</label><input className="input" value={form.nationality} onChange={e => setForm({ ...form, nationality: e.target.value })}/></div><div><label className="text-sm text-slate-500">ID Type</label><input className="input" value={form.idType} onChange={e => setForm({ ...form, idType: e.target.value })} placeholder="Passport"/></div><div><label className="text-sm text-slate-500">ID Number</label><input className="input" value={form.idNumber} onChange={e => setForm({ ...form, idNumber: e.target.value })}/></div></div>
            <div className="flex gap-2 pt-2"><button type="button" className="btn-secondary flex-1" onClick={() => setShowForm(false)}>Cancel</button><button type="submit" className="btn-primary flex-1">Create Guest</button></div>
          </form>
        </div>
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// HOUSEKEEPING PAGE
// ═══════════════════════════════════════════════════════════════════
function HousekeepingPage() {
  const auth = useAuth();
  const [tasks, setTasks] = useState([]); const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(""); const [rooms, setRooms] = useState([]);
  const [showForm, setShowForm] = useState(false); const [form, setForm] = useState({ roomId: "", taskType: "CLEANING", priority: "NORMAL", notes: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try { const params = filter ? { status: filter } : undefined; setTasks(await auth.fetchHousekeeping(params)); } catch {} finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { load(); auth.fetchRooms().then(setRooms).catch(() => {}); }, []);

  async function handleStatus(id, status) {
    try { await auth.updateHousekeepingTask(id, { status }); load(); auth.notifyDataChange(); } catch (err) { alert(err.message); }
  }

  async function handleCreate(e) {
    e.preventDefault(); try { await auth.createHousekeepingTask(form); setShowForm(false); setForm({ roomId: "", taskType: "CLEANING", priority: "NORMAL", notes: "" }); load(); } catch (err) { alert(err.message); }
  }

  return (
    <div>
      <PageHeader title="Housekeeping" subtitle="Room cleaning, inspection and linen management" actions={
        <div className="flex gap-2">
          <select className="select h-10 w-36" value={filter} onChange={e => setFilter(e.target.value)}><option value="">All Status</option>{["PENDING","IN_PROGRESS","COMPLETED"].map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select>
          <button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={17}/> New Task</button>
        </div>
      }/>

      <div className="card"><div className="table-wrap"><table>
        <thead><tr><th>ROOM</th><th>TYPE</th><th>PRIORITY</th><th>STATUS</th><th>ASSIGNED</th><th>ACTIONS</th></tr></thead>
        <tbody>{loading ? <tr><td colSpan={6} className="text-center py-8 text-slate-400">Loading…</td></tr> :
          tasks.map(t => <tr key={t.id}>
            <td className="font-semibold">{t.room_number || "—"}</td><td>{t.task_type?.replace("_", " ")}</td>
            <td><StatusBadge status={t.priority}/></td>
            <td><StatusBadge status={t.status}/></td>
            <td className="text-slate-500 text-sm">{t.assigned_name || "—"}</td>
            <td><div className="flex gap-1">
              {t.status === "PENDING" && <button className="btn-secondary btn-sm" onClick={() => handleStatus(t.id, "IN_PROGRESS")}><Play size={14}/> Start</button>}
              {t.status === "IN_PROGRESS" && <button className="btn-success btn-sm" onClick={() => handleStatus(t.id, "COMPLETED")}><Check size={14}/> Done</button>}
            </div></td>
          </tr>)}
          {!loading && !tasks.length && <tr><td colSpan={6} className="text-center py-12 text-slate-400">No tasks found</td></tr>}
        </tbody></table></div></div>

      {showForm && <div className="modal-overlay" onClick={() => setShowForm(false)}>
        <div className="modal-content max-w-md p-6" onClick={e => e.stopPropagation()}>
          <h2 className="text-xl font-semibold mb-4">New Housekeeping Task</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            <div><label className="text-sm text-slate-500">Room</label><select className="select" value={form.roomId} onChange={e => setForm({ ...form, roomId: e.target.value })} required><option value="">Select room…</option>{rooms.map(r => <option key={r.id} value={r.id}>Room {r.number}</option>)}</select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-sm text-slate-500">Task Type</label><select className="select" value={form.taskType} onChange={e => setForm({ ...form, taskType: e.target.value })}><option>CLEANING</option><option>INSPECTION</option><option>TURNDOWN</option><option>DEEP_CLEAN</option></select></div>
              <div><label className="text-sm text-slate-500">Priority</label><select className="select" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}><option>NORMAL</option><option>HIGH</option><option>URGENT</option><option>LOW</option></select></div>
            </div>
            <div><label className="text-sm text-slate-500">Notes</label><textarea className="input h-16 resize-none" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}/></div>
            <div className="flex gap-2 pt-2"><button type="button" className="btn-secondary flex-1" onClick={() => setShowForm(false)}>Cancel</button><button type="submit" className="btn-primary flex-1">Create Task</button></div>
          </form>
        </div>
      </div>}
    </div>
  );
}

const Play = ({ size, className }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><polygon points="5 3 19 12 5 21 5 3"/></svg>;

// ═══════════════════════════════════════════════════════════════════
// FOOD & BEVERAGE PAGE
// ═══════════════════════════════════════════════════════════════════
function FoodBeveragePage() {
  const auth = useAuth();
  const [menu, setMenu] = useState([]); const [orders, setOrders] = useState([]);
  const [activeTab, setActiveTab] = useState("menu"); const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    if (activeTab === "menu") auth.fetchMenu().then(setMenu).catch(() => {}).finally(() => setLoading(false));
    else auth.fetchRestaurantOrders().then(setOrders).catch(() => {}).finally(() => setLoading(false));
  }, [activeTab]);

  const categories = [...new Set(menu.map(m => m.category))];

  async function handleOrderStatus(id, status) {
    try { await auth.updateRestaurantOrder(id, { status }); auth.fetchRestaurantOrders().then(setOrders); } catch (err) { alert(err.message); }
  }

  return (
    <div>
      <PageHeader title="Food & Beverage" subtitle="Restaurant menu, room service and kitchen operations"/>
      <div className="flex gap-2 mb-6">
        <button className={`btn-sm btn ${activeTab === "menu" ? "bg-navy-900 text-white dark:bg-brand-400 dark:text-navy-950" : "btn-secondary"}`} onClick={() => setActiveTab("menu")}><UtensilsCrossed size={16}/> Menu</button>
        <button className={`btn-sm btn ${activeTab === "orders" ? "bg-navy-900 text-white dark:bg-brand-400 dark:text-navy-950" : "btn-secondary"}`} onClick={() => setActiveTab("orders")}><Receipt size={16}/> Orders ({orders.filter(o => o.status !== "COMPLETED").length})</button>
      </div>

      {activeTab === "menu" ? (
        categories.map(cat => <div key={cat} className="mb-6">
          <h3 className="font-semibold text-lg mb-3 flex items-center gap-2"><ChefHat size={18}/> {cat}</h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {menu.filter(m => m.category === cat).map(item => <div key={item.id} className="card p-4 hover:shadow-md transition">
              <div className="flex justify-between items-start">
                <div><div className="font-medium">{item.name}</div><div className="text-xs text-slate-500 mt-1">{item.description}</div></div>
                <div className="text-right"><div className="font-bold text-brand-600">₦{Number(item.price).toLocaleString()}</div><div className="text-xs text-slate-400">{item.preparation_time}min</div></div>
              </div>
              <div className="flex gap-2 mt-3">
                {item.is_vegetarian && <span className="badge badge-success">Vegetarian</span>}
                {item.is_vegan && <span className="badge badge-success">Vegan</span>}
                {!item.is_available && <span className="badge badge-danger">Unavailable</span>}
              </div>
            </div>)}
          </div>
        </div>)
      ) : (
        <div className="card"><div className="table-wrap"><table>
          <thead><tr><th>ORDER #</th><th>TYPE</th><th>ROOM</th><th>ITEMS</th><th>TOTAL</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
          <tbody>{orders.map(o => <tr key={o.id}>
            <td className="font-mono font-semibold text-sm">#{o.id}</td><td>{o.order_type?.replace("_", " ")}</td>
            <td>{o.room_number || "Dine-in"}</td>
            <td className="text-sm">{o.items?.map(i => `${i.qty}x ${i.name}`).join(", ") || "—"}</td>
            <td className="font-semibold">₦{Number(o.total_amount || 0).toLocaleString()}</td>
            <td><StatusBadge status={o.status}/></td>
            <td><div className="flex gap-1">
              {o.status === "PENDING" && <button className="btn-secondary btn-sm" onClick={() => handleOrderStatus(o.id, "IN_PROGRESS")}>Start</button>}
              {o.status === "IN_PROGRESS" && <button className="btn-success btn-sm" onClick={() => handleOrderStatus(o.id, "COMPLETED")}>Complete</button>}
            </div></td>
          </tr>)}
          {!orders.length && <tr><td colSpan={7} className="text-center py-12 text-slate-400">No orders yet</td></tr>}
        </tbody></table></div></div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SPA & WELLNESS PAGE
// ═══════════════════════════════════════════════════════════════════
function SpaWellnessPage() {
  const auth = useAuth();
  const [services, setServices] = useState([]); const [appointments, setAppointments] = useState([]);
  const [activeTab, setActiveTab] = useState("services"); const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    if (activeTab === "services") auth.fetchSpaServices().then(setServices).catch(() => {}).finally(() => setLoading(false));
    else auth.fetchSpaAppointments().then(setAppointments).catch(() => {}).finally(() => setLoading(false));
  }, [activeTab]);

  const categories = [...new Set(services.map(s => s.category))];

  async function handleAppointmentStatus(id, status) {
    try { await auth.updateSpaAppointment(id, { status }); auth.fetchSpaAppointments().then(setAppointments); } catch (err) { alert(err.message); }
  }

  return (
    <div>
      <PageHeader title="Spa & Wellness" subtitle="Treatments, appointments and facility management"/>
      <div className="flex gap-2 mb-6">
        <button className={`btn-sm btn ${activeTab === "services" ? "bg-navy-900 text-white dark:bg-brand-400 dark:text-navy-950" : "btn-secondary"}`} onClick={() => setActiveTab("services")}><Flower2 size={16}/> Services</button>
        <button className={`btn-sm btn ${activeTab === "appointments" ? "bg-navy-900 text-white dark:bg-brand-400 dark:text-navy-950" : "btn-secondary"}`} onClick={() => setActiveTab("appointments")}><Calendar size={16}/> Appointments</button>
      </div>

      {activeTab === "services" ? (
        categories.map(cat => <div key={cat} className="mb-6">
          <h3 className="font-semibold text-lg mb-3 flex items-center gap-2"><Flower2 size={18}/> {cat}</h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {services.filter(s => s.category === cat).map(svc => <div key={svc.id} className="card p-4 hover:shadow-md transition">
              <div className="flex justify-between items-start">
                <div><div className="font-medium">{svc.name}</div><div className="text-xs text-slate-500 mt-1">{svc.description}</div></div>
                <div className="text-right"><div className="font-bold text-brand-600">₦{Number(svc.price).toLocaleString()}</div><div className="text-xs text-slate-400">{svc.duration_minutes}min</div></div>
              </div>
            </div>)}
          </div>
        </div>)
      ) : (
        <div className="card"><div className="table-wrap"><table>
          <thead><tr><th>GUEST</th><th>SERVICE</th><th>DATE</th><th>TIME</th><th>THERAPIST</th><th>AMOUNT</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
          <tbody>{appointments.map(a => <tr key={a.id}>
            <td className="font-medium">{a.guest_name || "—"}</td><td>{a.service_name}</td>
            <td className="text-sm">{a.appointment_date}</td><td className="text-sm">{a.appointment_time}</td>
            <td className="text-sm">{a.therapist_name || "—"}</td>
            <td className="font-semibold">₦{Number(a.price || 0).toLocaleString()}</td>
            <td><StatusBadge status={a.status}/></td>
            <td><div className="flex gap-1">
              {a.status === "SCHEDULED" && <button className="btn-secondary btn-sm" onClick={() => handleAppointmentStatus(a.id, "IN_PROGRESS")}>Start</button>}
              {a.status === "IN_PROGRESS" && <button className="btn-success btn-sm" onClick={() => handleAppointmentStatus(a.id, "COMPLETED")}>Done</button>}
            </div></td>
          </tr>)}
          {!appointments.length && <tr><td colSpan={8} className="text-center py-12 text-slate-400">No appointments</td></tr>}
        </tbody></table></div></div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EVENTS PAGE
// ═══════════════════════════════════════════════════════════════════
function EventsPage() {
  const auth = useAuth();
  const [events, setEvents] = useState([]); const [loading, setLoading] = useState(true);

  useEffect(() => { auth.fetchEvents().then(setEvents).catch(() => {}).finally(() => setLoading(false)); }, []);

  async function handleEventStatus(id, status) {
    try { await auth.updateEvent(id, { status }); auth.fetchEvents().then(setEvents); } catch (err) { alert(err.message); }
  }

  const eventTypeIcons = { Wedding: "💒", Conference: "🎤", Gala: "🎭", Meeting: "📋", Party: "🎉" };

  return (
    <div>
      <PageHeader title="Events & Banqueting" subtitle="Function spaces, weddings, conferences and event management" actions={
        <button className="btn-primary"><Plus size={17}/> New Event</button>
      }/>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {events.map(e => <div key={e.id} className="card p-5 hover:shadow-md transition">
          <div className="flex items-start justify-between mb-3">
            <div className="text-3xl">{eventTypeIcons[e.event_type] || "🎪"}</div>
            <StatusBadge status={e.status}/>
          </div>
          <h3 className="font-semibold text-lg">{e.title}</h3>
          <div className="text-sm text-slate-500 mt-1">{e.space_name} · {e.event_type}</div>
          <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
            <div className="bg-slate-50 dark:bg-navy-950/50 rounded-xl p-3"><div className="text-slate-400 text-xs">Date</div><div className="font-medium">{e.start_date}{e.end_date !== e.start_date ? ` → ${e.end_date}` : ""}</div></div>
            <div className="bg-slate-50 dark:bg-navy-950/50 rounded-xl p-3"><div className="text-slate-400 text-xs">Guests</div><div className="font-medium">{e.guest_count}</div></div>
          </div>
          <div className="flex justify-between items-center mt-4">
            <div><span className="text-xs text-slate-400">Revenue</span><div className="font-bold">₦{Number(e.estimated_revenue || 0).toLocaleString()}</div></div>
            <div className="flex gap-1">
              {e.status === "INQUIRY" && <button className="btn-secondary btn-sm" onClick={() => handleEventStatus(e.id, "CONFIRMED")}>Confirm</button>}
              {e.status === "CONFIRMED" && <button className="btn-success btn-sm" onClick={() => handleEventStatus(e.id, "IN_PROGRESS")}>Start</button>}
              {e.status === "IN_PROGRESS" && <button className="btn-primary btn-sm" onClick={() => handleEventStatus(e.id, "COMPLETED")}>Complete</button>}
            </div>
          </div>
        </div>)}
        {!loading && !events.length && <div className="col-span-full"><EmptyState icon={PartyPopper} title="No events" description="Create your first event booking."/></div>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAINTENANCE PAGE
// ═══════════════════════════════════════════════════════════════════
function MaintenancePage() {
  const auth = useAuth();
  const [requests, setRequests] = useState([]); const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(""); const [rooms, setRooms] = useState([]);
  const [showForm, setShowForm] = useState(false); const [form, setForm] = useState({ roomId: "", title: "", description: "", priority: "NORMAL", category: "GENERAL" });

  const load = useCallback(async () => {
    setLoading(true);
    try { const params = filter ? { status: filter } : undefined; setRequests(await auth.fetchMaintenance(params)); } catch {} finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { load(); auth.fetchRooms().then(setRooms).catch(() => {}); }, []);

  async function handleStatus(id, status) {
    try { await auth.updateMaintenanceRequest(id, { status }); load(); auth.notifyDataChange(); } catch (err) { alert(err.message); }
  }

  async function handleCreate(e) {
    e.preventDefault(); try { await auth.createMaintenanceRequest(form); setShowForm(false); setForm({ roomId: "", title: "", description: "", priority: "NORMAL", category: "GENERAL" }); load(); } catch (err) { alert(err.message); }
  }

  return (
    <div>
      <PageHeader title="Maintenance" subtitle="Work orders, preventive maintenance and facility management" actions={
        <div className="flex gap-2">
          <select className="select h-10 w-36" value={filter} onChange={e => setFilter(e.target.value)}><option value="">All Status</option>{["OPEN","IN_PROGRESS","COMPLETED"].map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select>
          <button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={17}/> New Request</button>
        </div>
      }/>

      <div className="card"><div className="table-wrap"><table>
        <thead><tr><th>TITLE</th><th>ROOM</th><th>CATEGORY</th><th>PRIORITY</th><th>STATUS</th><th>ASSIGNED</th><th>ACTIONS</th></tr></thead>
        <tbody>{loading ? <tr><td colSpan={7} className="text-center py-8 text-slate-400">Loading…</td></tr> :
          requests.map(m => <tr key={m.id}>
            <td className="font-semibold">{m.title}</td><td className="text-slate-500">{m.room_number || "General"}</td>
            <td className="text-sm">{m.category}</td>
            <td><StatusBadge status={m.priority}/></td>
            <td><StatusBadge status={m.status}/></td>
            <td className="text-slate-500 text-sm">{m.assigned_name || "—"}</td>
            <td><div className="flex gap-1">
              {m.status === "OPEN" && <button className="btn-secondary btn-sm" onClick={() => handleStatus(m.id, "IN_PROGRESS")}><Play size={14}/> Start</button>}
              {m.status === "IN_PROGRESS" && <button className="btn-success btn-sm" onClick={() => handleStatus(m.id, "COMPLETED")}><Check size={14}/> Done</button>}
            </div></td>
          </tr>)}
          {!loading && !requests.length && <tr><td colSpan={7} className="text-center py-12 text-slate-400">No maintenance requests</td></tr>}
        </tbody></table></div></div>

      {showForm && <div className="modal-overlay" onClick={() => setShowForm(false)}>
        <div className="modal-content max-w-md p-6" onClick={e => e.stopPropagation()}>
          <h2 className="text-xl font-semibold mb-4">New Maintenance Request</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            <div><label className="text-sm text-slate-500">Title</label><input className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required placeholder="e.g. Leaking faucet"/></div>
            <div><label className="text-sm text-slate-500">Room</label><select className="select" value={form.roomId} onChange={e => setForm({ ...form, roomId: e.target.value })}><option value="">General area</option>{rooms.map(r => <option key={r.id} value={r.id}>Room {r.number}</option>)}</select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-sm text-slate-500">Category</label><select className="select" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{["GENERAL","PLUMBING","ELECTRICAL","HVAC","FURNITURE","TECHNOLOGY"].map(c => <option key={c}>{c}</option>)}</select></div>
              <div><label className="text-sm text-slate-500">Priority</label><select className="select" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>{["NORMAL","HIGH","URGENT","LOW"].map(p => <option key={p}>{p}</option>)}</select></div>
            </div>
            <div><label className="text-sm text-slate-500">Description</label><textarea className="input h-20 resize-none" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}/></div>
            <div className="flex gap-2 pt-2"><button type="button" className="btn-secondary flex-1" onClick={() => setShowForm(false)}>Cancel</button><button type="submit" className="btn-primary flex-1">Submit Request</button></div>
          </form>
        </div>
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// FINANCE PAGE
// ═══════════════════════════════════════════════════════════════════
function FinancePage() {
  const auth = useAuth();
  const { format } = useCurrency();
  const [summary, setSummary] = useState(null); const [expenses, setExpenses] = useState([]);
  const [activeTab, setActiveTab] = useState("overview"); const [loading, setLoading] = useState(true);
  const [showPayment, setShowPayment] = useState(false);

  useEffect(() => {
    setLoading(true);
    auth.fetchFinanceSummary().then(setSummary).catch(() => {});
    auth.fetchExpenses().then(setExpenses).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader title="Finance" subtitle="Revenue, expenses, folios and financial reporting" actions={<button className="btn-primary" onClick={() => setShowPayment(true)}><CreditCard size={16}/> Process Payment</button>}/>
      <div className="flex gap-2 mb-6">
        {[["overview", BarChart3, "Overview"], ["payments", CreditCard, "Payments"], ["expenses", Receipt, "Expenses"]].map(([key, Icon, label]) =>
          <button key={key} className={`btn-sm btn ${activeTab === key ? "bg-navy-900 text-white dark:bg-brand-400 dark:text-navy-950" : "btn-secondary"}`} onClick={() => setActiveTab(key)}><Icon size={16}/> {label}</button>
        )}
      </div>

      {activeTab === "overview" && summary && <div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <MetricCard icon={TrendingUp} label="Total Revenue" value={format(summary.totalRevenue || 0)} delta="All time" accent="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"/>
          <MetricCard icon={Wallet} label="Today's Payments" value={format(summary.todayRevenue || 0)} delta="Live" accent="bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400"/>
          <MetricCard icon={Receipt} label="Total Expenses" value={format(summary.totalExpenses || 0)} delta="Approved" accent="bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"/>
          <MetricCard icon={CircleDollarSign} label="Outstanding" value={format(summary.outstandingBalance || 0)} delta={`${summary.outstandingBalance > 0 ? "Owed" : "Clear"}`} accent="bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400"/>
        </div>
        <div className="card p-5"><h3 className="font-semibold mb-3">Net Income</h3><div className="text-3xl font-bold text-emerald-600">{format(summary.netIncome || 0)}</div><div className="text-sm text-slate-500 mt-1">Revenue minus approved expenses</div></div>
      </div>}

      {showPayment && <PaymentModal open={showPayment} onClose={() => setShowPayment(false)} onPaymentComplete={() => { auth.fetchFinanceSummary().then(setSummary); }} guestName="Hotel Guest"/>}

      {activeTab === "payments" && <div className="card"><div className="table-wrap"><table>
        <thead><tr><th>GUEST</th><th>DESCRIPTION</th><th>AMOUNT</th><th>DATE</th></tr></thead>
        <tbody>{(summary?.recentPayments || []).map(p => <tr key={p.id}>
          <td className="font-medium">{p.guest_name}</td><td className="text-sm">{p.description}</td>
          <td className="font-semibold text-emerald-600">{format(Math.abs(Number(p.amount)))}</td>
          <td className="text-sm text-slate-500">{new Date(p.created_at).toLocaleDateString()}</td>
        </tr>)}</tbody></table></div></div>}

      {activeTab === "expenses" && <div className="card"><div className="table-wrap"><table>
        <thead><tr><th>DESCRIPTION</th><th>CATEGORY</th><th>AMOUNT</th><th>VENDOR</th><th>STATUS</th></tr></thead>
        <tbody>{expenses.length ? expenses.map(e => <tr key={e.id}>
          <td className="font-medium">{e.description}</td><td className="text-sm">{e.category_name}</td>
          <td className="font-semibold">{format(Number(e.amount || 0))}</td>
          <td className="text-sm text-slate-500">{e.vendor || "—"}</td>
          <td><StatusBadge status={e.status}/></td>
        </tr>) : <tr><td colSpan={5} className="text-center py-12 text-slate-400">No expenses recorded</td></tr>}
        </tbody></table></div></div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TEAM PAGE
// ═══════════════════════════════════════════════════════════════════
function TeamPage() {
  const auth = useAuth();
  const [users, setUsers] = useState([]); const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "STAFF", department: "" });
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { setUsers(await auth.fetchUsers()); } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function handleCreate(e) {
    e.preventDefault(); setMsg("");
    try { await auth.createUser(form); setShowForm(false); setForm({ name: "", email: "", password: "", role: "STAFF", department: "" }); setMsg("Team member added!"); load(); }
    catch (err) { setMsg(`Error: ${err.message}`); }
  }

  async function toggleActive(u) {
    try { await auth.updateUser(u.id, { isActive: !u.is_active }); load(); } catch (err) { alert(err.message); }
  }

  const roleColors = { ADMIN: "badge-violet", MANAGER: "badge-warning", FRONT_DESK: "badge-info", HOUSEKEEPING: "badge-success", RESTAURANT: "badge bg-orange-100 text-orange-700", MAINTENANCE: "badge bg-amber-100 text-amber-700", STAFF: "badge-slate" };

  return (
    <div>
      <PageHeader title="Team Management" subtitle={`${users.length} team members`} actions={
        <button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={17}/> Add Member</button>
      }/>

      {msg && <div className={`p-3 rounded-xl mb-4 text-sm flex items-center gap-2 ${msg.startsWith("Error") ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>{msg.startsWith("Error") ? <XCircle size={16}/> : <CheckCircle2 size={16}/>}{msg}</div>}

      <div className="card"><div className="table-wrap"><table>
        <thead><tr><th>NAME</th><th>EMAIL</th><th>ROLE</th><th>DEPARTMENT</th><th>STATUS</th><th>LAST LOGIN</th><th></th></tr></thead>
        <tbody>{loading ? <tr><td colSpan={7} className="text-center py-8 text-slate-400">Loading…</td></tr> :
          users.map(u => <tr key={u.id}>
            <td><div className="flex items-center gap-3"><div className="h-9 w-9 rounded-xl bg-gradient-to-br from-brand-100 to-brand-200 text-brand-700 grid place-items-center text-xs font-bold">{u.name?.split(" ").map(n=>n[0]).join("")}</div><b>{u.name}</b></div></td>
            <td className="text-slate-500 text-sm">{u.email}</td>
            <td><span className={roleColors[u.role] || "badge-slate"}>{u.role?.replace("_", " ")}</span></td>
            <td className="text-sm">{u.department || "—"}</td>
            <td><span className={u.is_active ? "badge-success" : "badge-danger"}>{u.is_active ? "Active" : "Inactive"}</span></td>
            <td className="text-xs text-slate-500">{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : "Never"}</td>
            <td><button className="btn-ghost btn-sm text-xs" onClick={() => toggleActive(u)}>{u.is_active ? "Deactivate" : "Activate"}</button></td>
          </tr>)}
        </tbody></table></div></div>

      {showForm && <div className="modal-overlay" onClick={() => setShowForm(false)}>
        <div className="modal-content max-w-md p-6" onClick={e => e.stopPropagation()}>
          <h2 className="text-xl font-semibold mb-4">Add Team Member</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            <div><label className="text-sm text-slate-500">Full Name</label><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required/></div>
            <div><label className="text-sm text-slate-500">Email</label><input className="input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required/></div>
            <div><label className="text-sm text-slate-500">Password</label><input className="input" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required minLength={6}/></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-sm text-slate-500">Role</label><select className="select" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>{["ADMIN","MANAGER","FRONT_DESK","HOUSEKEEPING","RESTAURANT","MAINTENANCE","STAFF"].map(r => <option key={r} value={r}>{r.replace("_", " ")}</option>)}</select></div>
              <div><label className="text-sm text-slate-500">Department</label><input className="input" value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} placeholder="e.g. Front Office"/></div>
            </div>
            <div className="flex gap-2 pt-2"><button type="button" className="btn-secondary flex-1" onClick={() => setShowForm(false)}>Cancel</button><button type="submit" className="btn-primary flex-1">Add Member</button></div>
          </form>
        </div>
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SECURITY PAGE
// ═══════════════════════════════════════════════════════════════════
function SecurityPage() {
  const auth = useAuth();
  const [incidents, setIncidents] = useState([]); const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false); const [form, setForm] = useState({ title: "", incidentType: "UNAUTHORIZED_ACCESS", severity: "LOW", location: "", description: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try { setIncidents(await auth.fetchSecurityIncidents()); } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function handleCreate(e) {
    e.preventDefault(); try { await auth.createSecurityIncident(form); setShowForm(false); setForm({ title: "", incidentType: "UNAUTHORIZED_ACCESS", severity: "LOW", location: "", description: "" }); load(); } catch (err) { alert(err.message); }
  }

  async function handleStatus(id, status) {
    try { await auth.updateSecurityIncident(id, { status }); load(); } catch (err) { alert(err.message); }
  }

  return (
    <div>
      <PageHeader title="Security" subtitle="Incident reporting, access control and safety management" actions={
        <button className="btn-primary" onClick={() => setShowForm(true)}><Plus size={17}/> Report Incident</button>
      }/>

      <div className="card"><div className="table-wrap"><table>
        <thead><tr><th>TITLE</th><th>TYPE</th><th>SEVERITY</th><th>LOCATION</th><th>REPORTED BY</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
        <tbody>{loading ? <tr><td colSpan={7} className="text-center py-8 text-slate-400">Loading…</td></tr> :
          incidents.map(i => <tr key={i.id}>
            <td className="font-semibold">{i.title}</td><td className="text-sm">{i.incident_type?.replace(/_/g, " ")}</td>
            <td><StatusBadge status={i.severity}/></td>
            <td className="text-sm">{i.location || "—"}</td>
            <td className="text-sm text-slate-500">{i.reported_by_name || "—"}</td>
            <td><StatusBadge status={i.status}/></td>
            <td>{i.status === "OPEN" && <button className="btn-secondary btn-sm" onClick={() => handleStatus(i.id, "RESOLVED")}>Resolve</button>}</td>
          </tr>)}
          {!loading && !incidents.length && <tr><td colSpan={7} className="text-center py-12 text-slate-400">No security incidents</td></tr>}
        </tbody></table></div></div>

      {showForm && <div className="modal-overlay" onClick={() => setShowForm(false)}>
        <div className="modal-content max-w-md p-6" onClick={e => e.stopPropagation()}>
          <h2 className="text-xl font-semibold mb-4">Report Security Incident</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            <div><label className="text-sm text-slate-500">Title</label><input className="input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required placeholder="Brief description"/></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-sm text-slate-500">Type</label><select className="select" value={form.incidentType} onChange={e => setForm({ ...form, incidentType: e.target.value })}>{["UNAUTHORIZED_ACCESS","THEFT","FIRE_SAFETY","MEDICAL","SUSPICIOUS_ACTIVITY","FIGHT","OTHER"].map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</select></div>
              <div><label className="text-sm text-slate-500">Severity</label><select className="select" value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })}>{["LOW","MEDIUM","HIGH","CRITICAL"].map(s => <option key={s} value={s}>{s}</option>)}</select></div>
            </div>
            <div><label className="text-sm text-slate-500">Location</label><input className="input" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="e.g. Main Lobby, Floor 5"/></div>
            <div><label className="text-sm text-slate-500">Description</label><textarea className="input h-20 resize-none" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}/></div>
            <div className="flex gap-2 pt-2"><button type="button" className="btn-secondary flex-1" onClick={() => setShowForm(false)}>Cancel</button><button type="submit" className="btn-danger flex-1">Submit Report</button></div>
          </form>
        </div>
      </div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SOUND CUSTOMIZATION PANEL
// ═══════════════════════════════════════════════════════════════════
function SoundCustomizationPanel() {
  const [prefs, setPrefs] = useState(() => getSoundPreferences());
  const [volume, setVol] = useState(() => getMasterVolume());
  const [enabled, setEnabled] = useState(() => isSoundEnabled());
  const [expanded, setExpanded] = useState(null);
  const [selectedPreset, setSelectedPreset] = useState({});

  function updatePref(type, patch) {
    const updated = { ...prefs, [type]: { ...prefs[type], ...patch } };
    setPrefs(updated);
    saveSoundPreferences(updated);
  }

  function handleVolumeChange(v) {
    setVol(v);
    setMasterVolume(v);
  }

  function handleEnabledToggle() {
    const next = !enabled;
    setEnabled(next);
    setSoundEnabled(next);
  }

  function handlePresetChange(type, presetKey) {
    const preset = TONE_PRESETS[presetKey];
    if (!preset) return;
    setSelectedPreset(prev => ({ ...prev, [type]: presetKey }));
    updatePref(type, {
      customTone: { notes: preset.notes, durations: preset.durations, waveform: preset.waveform },
    });
    // Play preview
    playNotificationSound(type, {
      notes: preset.notes,
      durations: preset.durations,
      waveform: preset.waveform,
      volume: prefs[type]?.volume ?? 0.3,
    });
  }

  function resetType(type) {
    const updated = { ...prefs, [type]: { preset: null, customTone: null, volume: DEFAULT_SOUNDS[type]?.volume ?? 0.3, enabled: true } };
    setPrefs(updated);
    saveSoundPreferences(updated);
    setSelectedPreset(prev => ({ ...prev, [type]: null }));
  }

  const types = Object.entries(DEFAULT_SOUNDS);

  return (
    <div className="card mt-5">
      <div className="p-5 border-b border-slate-100 dark:border-slate-700/50">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold flex items-center gap-2">🔔 Sound Customization</h3>
            <p className="text-xs text-slate-500 mt-1">Customize notification tones for each alert type</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              className={`relative h-6 w-11 rounded-full transition ${enabled ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"}`}
              onClick={handleEnabledToggle}
            >
              <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${enabled ? "left-[22px]" : "left-0.5"}`}/>
            </button>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* Master Volume */}
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-navy-950/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Master Volume</span>
            <span className="text-xs text-slate-500 font-mono">{Math.round(volume * 100)}%</span>
          </div>
          <input
            type="range" min="0" max="100" value={Math.round(volume * 100)}
            onChange={e => handleVolumeChange(Number(e.target.value) / 100)}
            className="w-full h-2 rounded-full appearance-none cursor-pointer"
            style={{ background: `linear-gradient(to right, #10b981 ${volume * 100}%, #e5e7eb ${volume * 100}%)` }}
          />
          <div className="flex justify-between text-xs text-slate-400 mt-1"><span>🔇</span><span>🔊</span></div>
        </div>

        {/* Quick Test */}
        <div className="p-4 rounded-xl bg-gradient-to-r from-brand-50 to-emerald-50 dark:from-brand-900/10 dark:to-emerald-900/10 border border-brand-200/50 dark:border-brand-800/30">
          <div className="text-sm font-medium mb-2">🧪 Quick Test</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(TONE_PRESETS).map(([key, preset]) => (
              <button
                key={key}
                onClick={() => previewTone(key)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-navy-800 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
              >
                ▶ {preset.name}
              </button>
            ))}
          </div>
        </div>

        {/* Per-Type Sound Configuration */}
        <div>
          <h4 className="text-sm font-semibold mb-3">Notification Tones</h4>
          <div className="space-y-2">
            {types.map(([type, config]) => {
              const pref = prefs[type] || {};
              const isExpanded = expanded === type;
              const hasCustom = pref.customTone != null;
              return (
                <div key={type} className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <div className="flex items-center justify-between p-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition cursor-pointer"
                    onClick={() => setExpanded(isExpanded ? null : type)}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg grid place-items-center text-white text-sm" style={{ background: config.color }}>
                        {pref.enabled !== false ? "♪" : "—"}
                      </div>
                      <div>
                        <div className="text-sm font-medium flex items-center gap-2">
                          {config.name}
                          <span className="text-xs font-mono text-slate-400">{type}</span>
                          {hasCustom && <span className="text-xs px-1.5 py-0.5 rounded bg-brand-100 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400">Custom</span>}
                        </div>
                        <div className="text-xs text-slate-500">{config.description}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={e => { e.stopPropagation(); previewTypeSound(type); }}
                        className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 grid place-items-center text-sm transition"
                        title="Preview sound"
                      >▶</button>
                      <button
                        onClick={e => { e.stopPropagation(); updatePref(type, { enabled: pref.enabled === false ? true : false }); }}
                        className={`relative h-5 w-9 rounded-full transition ${pref.enabled !== false ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"}`}
                        title={pref.enabled !== false ? "Mute" : "Unmute"}
                      >
                        <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${pref.enabled !== false ? "left-[18px]" : "left-0.5"}`}/>
                      </button>
                    </div>
                  </div>

                  {/* Expanded config panel */}
                  {isExpanded && (
                    <div className="px-3 pb-3 pt-1 border-t border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-navy-950/30">
                      <div className="mb-3">
                        <label className="text-xs font-medium text-slate-500 mb-1 block">Tone Preset</label>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            onClick={() => resetType(type)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition border ${!hasCustom ? "bg-brand-500 text-white border-brand-500" : "bg-white dark:bg-navy-800 border-slate-200 dark:border-slate-600 hover:bg-slate-50"}`}
                          >
                            Default
                          </button>
                          {Object.entries(TONE_PRESETS).map(([key, preset]) => (
                            <button
                              key={key}
                              onClick={() => handlePresetChange(type, key)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition border ${selectedPreset[type] === key ? "bg-brand-500 text-white border-brand-500" : "bg-white dark:bg-navy-800 border-slate-200 dark:border-slate-600 hover:bg-slate-50"}`}
                            >
                              {preset.name}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-slate-500 mb-1 block">Volume</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="range" min="5" max="50" value={Math.round((pref.volume ?? config.volume ?? 0.3) * 100)}
                            onChange={e => updatePref(type, { volume: Number(e.target.value) / 100 })}
                            className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
                            style={{ background: `linear-gradient(to right, ${config.color} ${((pref.volume ?? config.volume ?? 0.3) * 100 / 50) * 100}%, #e5e7eb ${((pref.volume ?? config.volume ?? 0.3) * 100 / 50) * 100}%)` }}
                          />
                          <span className="text-xs font-mono text-slate-500 w-8 text-right">{Math.round((pref.volume ?? config.volume ?? 0.3) * 100)}%</span>
                          <button
                            onClick={() => playNotificationSound(type, {
                              notes: pref.customTone?.notes || config.notes,
                              durations: pref.customTone?.durations || config.durations,
                              waveform: pref.customTone?.waveform || config.waveform,
                              volume: pref.volume ?? config.volume,
                            })}
                            className="px-2 py-1 rounded-lg text-xs bg-white dark:bg-navy-800 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 font-medium"
                          >
                            ▶ Test
                          </button>
                        </div>
                      </div>
                      {hasCustom && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="text-xs text-slate-400">Waveform:</span>
                          <span className="text-xs font-mono text-slate-600 dark:text-slate-300">{pref.customTone.waveform}</span>
                          <span className="text-xs text-slate-400 ml-2">Notes:</span>
                          <span className="text-xs font-mono text-slate-600 dark:text-slate-300">{pref.customTone.notes.length}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// NOTIFICATION ANALYTICS PANEL
// ═══════════════════════════════════════════════════════════════════
function NotificationAnalyticsPanel() {
  const auth = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(30);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    setLoading(true);
    auth.request(`/notification-analytics?days=${period}`).then(d => { setData(d); }).catch(() => {}).finally(() => setLoading(false));
  }, [period, auth]);

  if (loading) return <div className="card mt-5"><div className="p-8 text-center text-slate-400"><div className="h-8 w-8 border-2 border-slate-300 border-t-brand-500 rounded-full animate-spin mx-auto mb-3"/> Loading analytics...</div></div>;
  if (!data?.ok) return <div className="card mt-5"><div className="p-8 text-center text-slate-400">Failed to load analytics</div></div>;

  const { summary, staff, guest, channels } = data;
  const typeColors = { ROOM_SERVICE: '#10b981', SPA: '#8b5cf6', HOUSEKEEPING: '#0ea5e9', MAINTENANCE: '#f59e0b', SECURITY: '#ef4444', SHIFT: '#6366f1', CHECK_IN: '#10b981', CHECK_OUT: '#f59e0b', FEEDBACK: '#ec4899', GENERAL: '#6b7280', INFO: '#3b82f6', WARNING: '#f59e0b', ERROR: '#ef4444', MANUAL: '#8b5cf6' };
  const typeIcons = { ROOM_SERVICE: '🍽️', SPA: '💆', HOUSEKEEPING: '🧹', MAINTENANCE: '🔧', SECURITY: '🛡️', SHIFT: '📅', CHECK_IN: '🏨', CHECK_OUT: '👋', FEEDBACK: '⭐', GENERAL: '📢', INFO: 'ℹ️', WARNING: '⚠️', ERROR: '❌', MANUAL: '✏️' };

  // Build daily chart data
  const allDays = new Set([...(staff.daily || []).map(d => d.date), ...(guest.daily || []).map(d => d.date)]);
  const chartDays = [...allDays].sort().slice(-14); // last 14 days
  const chartData = chartDays.map(date => {
    const s = (staff.daily || []).find(d => d.date === date) || { total: 0, read: 0 };
    const g = (guest.daily || []).find(d => d.date === date) || { total: 0, email: 0, sms: 0 };
    return { date, staff: s.total, staffRead: s.read, guest: g.total, email: g.email, sms: g.sms };
  });
  const maxChartVal = Math.max(1, ...chartData.map(d => d.staff + d.guest));

  return (
    <div className="card mt-5">
      <div className="p-5 border-b border-slate-100 dark:border-slate-700/50">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="font-semibold flex items-center gap-2">📊 Notification Analytics</h3>
            <p className="text-xs text-slate-500 mt-1">Delivery rates, engagement and channel performance</p>
          </div>
          <div className="flex items-center gap-2">
            {[7, 14, 30, 90].map(d => (
              <button key={d} onClick={() => setPeriod(d)} className={`px-3 py-1 rounded-lg text-xs font-medium transition ${period === d ? 'bg-brand-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200'}`}>{d}D</button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-5">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <div className="p-4 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white">
            <div className="text-2xl font-bold">{summary.totalNotifications.toLocaleString()}</div>
            <div className="text-xs opacity-80 mt-1">Total Notifications</div>
          </div>
          <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white">
            <div className="text-2xl font-bold">{summary.overallSuccessRate}%</div>
            <div className="text-xs opacity-80 mt-1">Overall Success Rate</div>
          </div>
          <div className="p-4 rounded-xl bg-gradient-to-br from-violet-500 to-violet-600 text-white">
            <div className="text-2xl font-bold">{summary.staffReadRate}%</div>
            <div className="text-xs opacity-80 mt-1">Staff Read Rate</div>
          </div>
          <div className="p-4 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 text-white">
            <div className="text-2xl font-bold">{summary.guestDeliveryAttempts.toLocaleString()}</div>
            <div className="text-xs opacity-80 mt-1">Guest Delivery Attempts</div>
          </div>
        </div>

        {/* Channel Performance */}
        <div className="mb-6">
          <h4 className="text-sm font-semibold mb-3">Channel Performance</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {Object.entries(channels).map(([key, ch]) => (
              <div key={key} className="p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">{ch.icon}</span>
                  <span className="text-sm font-medium">{ch.name}</span>
                </div>
                <div className="text-xl font-bold mb-1">{ch.total.toLocaleString()}</div>
                <div className="text-xs text-slate-500">sent</div>
                {ch.success != null && (
                  <div className="mt-2">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-emerald-600">✓ {ch.success} delivered</span>
                      {ch.failed > 0 && <span className="text-rose-600">✗ {ch.failed} failed</span>}
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${ch.total ? (ch.success / ch.total) * 100 : 0}%` }}/>
                    </div>
                  </div>
                )}
                {key === 'websocket' && (
                  <div className="mt-2">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-emerald-600">✓ {staff.read} read</span>
                      <span className="text-amber-600">⏳ {staff.unread} unread</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${summary.staffReadRate}%` }}/>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Tabs: Breakdown | Timeline */}
        <div className="flex gap-1 mb-4 border-b border-slate-200 dark:border-slate-700">
          {[['overview', 'Type Breakdown'], ['timeline', 'Daily Timeline']].map(([k, label]) => (
            <button key={k} onClick={() => setActiveTab(k)} className={`px-4 py-2 text-sm font-medium border-b-2 transition ${activeTab === k ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{label}</button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Staff by Type */}
            <div>
              <h4 className="text-sm font-semibold mb-3">Staff Notifications by Type</h4>
              <div className="space-y-2">
                {Object.entries(staff.byType).sort((a, b) => b[1].total - a[1].total).map(([type, stats]) => (
                  <div key={type} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <span className="text-lg">{typeIcons[type] || '📢'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium truncate">{type.replace(/_/g, ' ')}</span>
                        <span className="text-xs text-slate-500 ml-2">{stats.total}</span>
                      </div>
                      <div className="flex gap-3 text-xs text-slate-500 mt-0.5">
                        <span className="text-emerald-600">✓ {stats.read} read</span>
                        <span className="text-amber-600">⏳ {stats.unread} unread</span>
                        <span className="text-slate-400">{stats.total ? Math.round((stats.read / stats.total) * 100) : 0}% read</span>
                      </div>
                    </div>
                  </div>
                ))}
                {!Object.keys(staff.byType).length && <div className="text-center py-6 text-slate-400 text-sm">No staff notifications in this period</div>}
              </div>
            </div>

            {/* Guest by Type */}
            <div>
              <h4 className="text-sm font-semibold mb-3">Guest Delivery by Type</h4>
              <div className="space-y-2">
                {Object.entries(guest.byType).sort((a, b) => b[1].total - a[1].total).map(([type, stats]) => (
                  <div key={type} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <span className="text-lg">{typeIcons[type] || '📢'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium truncate">{type.replace(/_/g, ' ')}</span>
                        <span className="text-xs text-slate-500 ml-2">{stats.total}</span>
                      </div>
                      <div className="flex gap-3 text-xs text-slate-500 mt-0.5">
                        <span className="text-blue-600">📧 {stats.emailSent}</span>
                        <span className="text-emerald-600">📱 {stats.smsSent}</span>
                      </div>
                    </div>
                  </div>
                ))}
                {!Object.keys(guest.byType).length && <div className="text-center py-6 text-slate-400 text-sm">No guest deliveries in this period</div>}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'timeline' && (
          <div>
            <h4 className="text-sm font-semibold mb-3">Daily Activity (Last {Math.min(chartData.length, 14)} Days)</h4>
            {chartData.length ? (
              <div className="space-y-1">
                {/* Legend */}
                <div className="flex gap-4 text-xs text-slate-500 mb-2">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-500 inline-block"/> Staff</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-300 inline-block"/> Staff Read</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500 inline-block"/> Email</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-violet-500 inline-block"/> SMS</span>
                </div>
                {/* Chart rows */}
                {chartData.map(d => (
                  <div key={d.date} className="flex items-center gap-2 text-xs">
                    <span className="w-20 text-slate-500 shrink-0">{new Date(d.date).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })}</span>
                    <div className="flex-1 flex items-center gap-0.5 h-5">
                      {d.staff > 0 && <div className="h-full rounded" style={{ width: `${(d.staff / maxChartVal) * 100}%`, background: 'linear-gradient(90deg, #3b82f6, #60a5fa)', minWidth: 2 }} title={`${d.staff} staff`} />}
                      {d.email > 0 && <div className="h-full rounded" style={{ width: `${(d.email / maxChartVal) * 100}%`, background: '#10b981', minWidth: 2 }} title={`${d.email} email`} />}
                      {d.sms > 0 && <div className="h-full rounded" style={{ width: `${(d.sms / maxChartVal) * 100}%`, background: '#8b5cf6', minWidth: 2 }} title={`${d.sms} sms`} />}
                    </div>
                    <span className="w-12 text-right text-slate-400 shrink-0">{d.staff + d.guest}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-slate-400 text-sm">No data for this period</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SETTINGS PAGE
// ═══════════════════════════════════════════════════════════════════
function SettingsPage() {
  const auth = useAuth();
  const { currencies, baseCurrency, enabledCurrencies, changeBaseCurrency, format } = useCurrency();
  const [auditLogs, setAuditLogs] = useState([]); const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState([]);
  const [gatewayConfig, setGatewayConfig] = useState(null);
  const [notifPrefs, setNotifPrefs] = useState(null);
  const [notifSaving, setNotifSaving] = useState(false);

  useEffect(() => {
    auth.fetchAuditLogs().then(setAuditLogs).catch(() => {});
    auth.fetchPayments().then(setPayments).catch(() => {});
    auth.fetchNotificationPreferences().then(setNotifPrefs).catch(() => {}).finally(() => setLoading(false));
    auth.fetchPaymentGateways().then(setGatewayConfig).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader title="Settings" subtitle="System configuration, audit trails and hotel settings"/>
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="card p-6">
          <h3 className="font-semibold mb-4 flex items-center gap-2"><Building2 size={18}/> Hotel Information</h3>
          <div className="space-y-3">
            <div><label className="text-sm text-slate-500">Hotel Name</label><input className="input" value="RHoSAM Hotel & Suites" readOnly/></div>
            <div><label className="text-sm text-slate-500">Address</label><input className="input" value="Victoria Island, Lagos, Nigeria" readOnly/></div>
            <div><label className="text-sm text-slate-500">Phone</label><input className="input" value="+234 1 234 5678" readOnly/></div>
            <div><label className="text-sm text-slate-500">Currency</label><input className="input" value="Nigerian Naira (₦)" readOnly/></div>
            <div><label className="text-sm text-slate-500">Tax Rate</label><input className="input" value="7.5% VAT + 10% Service Charge" readOnly/></div>
          </div>
        </div>
        <div className="card p-6">
          <h3 className="font-semibold mb-4 flex items-center gap-2"><Lock size={18}/> Security & Access</h3>
          <div className="space-y-3">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-navy-950/50 flex justify-between items-center"><div><div className="font-medium text-sm">Role-Based Access Control</div><div className="text-xs text-slate-500">Enforced across all modules</div></div><StatusBadge status="ACTIVE"/></div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-navy-950/50 flex justify-between items-center"><div><div className="font-medium text-sm">Audit Trail Logging</div><div className="text-xs text-slate-500">All actions tracked with user, IP and timestamp</div></div><StatusBadge status="ACTIVE"/></div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-navy-950/50 flex justify-between items-center"><div><div className="font-medium text-sm">JWT Authentication</div><div className="text-xs text-slate-500">12-hour token rotation with secure storage</div></div><StatusBadge status="ACTIVE"/></div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-navy-950/50 flex justify-between items-center"><div><div className="font-medium text-sm">Double-Booking Protection</div><div className="text-xs text-slate-500">Preventive database-level constraints</div></div><StatusBadge status="ACTIVE"/></div>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5 mt-5">
        <div className="card p-6">
          <h3 className="font-semibold mb-4 flex items-center gap-2"><Globe size={18}/> Currency Settings</h3>
          <div className="space-y-3">
            <div><label className="text-sm text-slate-500 block mb-1">Base Currency</label>
              <select className="select" value={baseCurrency} onChange={e => changeBaseCurrency(e.target.value)}>
                {enabledCurrencies.map(code => {
                  const c = currencies[code];
                  return <option key={code} value={code}>{c?.symbol} {c?.name} ({code})</option>;
                })}
              </select>
            </div>
            <div><label className="text-sm text-slate-500 block mb-1">Enabled Currencies</label>
              <div className="flex flex-wrap gap-1.5">
                {enabledCurrencies.map(code => {
                  const c = currencies[code];
                  return <span key={code} className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-medium">{c?.symbol} {code}</span>;
                })}
              </div>
            </div>
            <div><label className="text-sm text-slate-500 block mb-1">Exchange Rates (to base: {baseCurrency})</label>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {Object.entries(currencies).filter(([code]) => code !== baseCurrency).map(([code, c]) => (
                  <div key={code} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-navy-950/50">
                    <span className="text-xs font-medium">{c.symbol} {code}</span>
                    <span className="text-xs text-slate-500">1 {code} = {c.rate ? (1 / c.rate).toFixed(2) : '—'} {baseCurrency}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="card p-6">
          <h3 className="font-semibold mb-4 flex items-center gap-2"><CreditCard size={18}/> Payment Gateways</h3>
          <div className="space-y-2">
            {[{ id: "stripe", name: "Stripe", desc: "Visa, Mastercard, Amex — Global", status: "active" },
              { id: "paystack", name: "Paystack", desc: "Cards, bank transfer, USSD — Africa", status: "active" },
              { id: "flutterwave", name: "Flutterwave", desc: "Cards, mobile money — Pan-African", status: "active" },
              { id: "manual", name: "Cash / Manual", desc: "Record cash, bank transfer, terminal", status: "active" }
            ].map(gw => (
              <div key={gw.id} className="p-3 rounded-xl bg-slate-50 dark:bg-navy-950/50 flex justify-between items-center">
                <div>
                  <div className="font-medium text-sm">{gw.name}</div>
                  <div className="text-xs text-slate-500">{gw.desc}</div>
                </div>
                <StatusBadge status={gw.status.toUpperCase()} />
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 rounded-xl bg-brand-50 dark:bg-brand-900/20 text-xs text-brand-700 dark:text-brand-400">
            Gateway credentials are configured in the backend <code>.env</code> file. Contact your administrator to update API keys.
          </div>
        </div>
      </div>

      {/* Notification Preferences */}
      <div className="card mt-5 p-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2"><Bell size={18}/> Notification Preferences</h3>
        {notifPrefs ? <div className="space-y-3">
          {[
            ["roomServiceUpdates", "Room Service Updates", "Get notified when room service orders change status"],
            ["spaReminders", "Spa Appointment Reminders", "Reminders for upcoming spa appointments"],
            ["housekeepingUpdates", "Housekeeping Updates", "Room cleaning and inspection status"],
            ["maintenanceUpdates", "Maintenance Updates", "Work order status changes"],
            ["guestRequests", "Guest Requests", "New guest concierge and service requests"],
            ["shiftUpdates", "Shift Updates", "Shift schedule changes and swap requests"],
            ["securityAlerts", "Security Alerts", "Critical security incident notifications"],
            ["general", "General Notifications", "System-wide announcements and updates"],
          ].map(([key, label, desc]) => (
            <div key={key} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-navy-950/50">
              <div><div className="font-medium text-sm">{label}</div><div className="text-xs text-slate-500">{desc}</div></div>
              <button className={`relative h-6 w-11 rounded-full transition ${notifPrefs[key] ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"}`} onClick={async () => {
                const updated = { ...notifPrefs, [key]: !notifPrefs[key] };
                setNotifPrefs(updated);
                setNotifSaving(true);
                try { await auth.updateNotificationPreferences(updated); } catch {}
                setNotifSaving(false);
              }}><div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${notifPrefs[key] ? "left-[22px]" : "left-0.5"}`}/></button>
            </div>
          ))}
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-navy-950/50">
            <div><div className="font-medium text-sm">Sound Alerts</div><div className="text-xs text-slate-500">Play a sound for real-time notifications</div></div>
            <button className={`relative h-6 w-11 rounded-full transition ${notifPrefs.sound_enabled ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"}`} onClick={async () => {
              const updated = { ...notifPrefs, sound_enabled: !notifPrefs.sound_enabled };
              setNotifPrefs(updated);
              setNotifSaving(true);
              try { await auth.updateNotificationPreferences(updated); } catch {}
              setNotifSaving(false);
            }}><div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${notifPrefs.sound_enabled ? "left-[22px]" : "left-0.5"}`}/></button>
          </div>
          {notifSaving && <div className="text-xs text-slate-400 flex items-center gap-1"><div className="h-3 w-3 border border-slate-300 border-t-brand-500 rounded-full animate-spin"/> Saving...</div>}
        </div> : <div className="text-center py-6 text-slate-400 text-sm">Loading preferences...</div>}
      </div>

      <SoundCustomizationPanel />

      <NotificationAnalyticsPanel />

      <div className="card mt-5">
        <div className="p-5 border-b border-slate-100 dark:border-slate-700/50">
          <h3 className="font-semibold flex items-center gap-2"><FileText size={18}/> Audit Trail</h3>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>USER</th><th>ACTION</th><th>ENTITY</th><th>DETAILS</th><th>TIME</th></tr></thead>
          <tbody>{loading ? <tr><td colSpan={5} className="text-center py-8 text-slate-400">Loading…</td></tr> :
            auditLogs.slice(0, 50).map(log => <tr key={log.id}>
              <td className="font-medium">{log.user_name || "System"}</td>
              <td><span className="badge-slate">{log.action}</span></td>
              <td className="text-sm">{log.entity_type} {log.entity_id ? `#${log.entity_id}` : ""}</td>
              <td className="text-xs text-slate-500 max-w-xs truncate">{JSON.stringify(log.details)}</td>
              <td className="text-xs text-slate-500">{new Date(log.created_at).toLocaleString()}</td>
            </tr>)}
            {!loading && !auditLogs.length && <tr><td colSpan={5} className="text-center py-8 text-slate-400">No audit logs</td></tr>}
          </tbody></table></div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// APP ROUTER
// ═══════════════════════════════════════════════════════════════════
function AppRoutes() {
  const auth = useAuth();
  const { user, loading } = auth;
  const navigate = useNavigate();

  useEffect(() => { if (!loading && user) navigate("/overview"); }, [user, loading]);

  if (loading) return <div className="min-h-screen bg-navy-950 flex items-center justify-center flex-col gap-4"><div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-brand-300 to-brand-500 grid place-items-center text-navy-950 animate-pulse"><Crown size={32}/></div><div className="text-brand-300 text-lg">Loading RHoSAM Hotel…</div></div>;
  if (!user) return <LoginPage />;

  return (
    <Layout>
      <Routes>
        <Route path="/overview" element={<OverviewPage />} />
        <Route path="/reservations" element={<ReservationsPage />} />
        <Route path="/front-desk" element={<FrontDeskPage />} />
        <Route path="/rooms" element={<RoomsPage />} />
        <Route path="/guests" element={<GuestsPage />} />
        <Route path="/housekeeping" element={<HousekeepingPage />} />
        <Route path="/food-beverage" element={<FoodBeveragePage />} />
        <Route path="/spa-wellness" element={<SpaWellnessPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/maintenance" element={<MaintenancePage />} />
        <Route path="/finance" element={<FinancePage />} />
        <Route path="/team" element={<TeamPage />} />
        <Route path="/scheduling" element={<SchedulingPage auth={auth} />} />
        <Route path="/swaps" element={<ShiftSwapPage auth={auth} />} />
        <Route path="/security" element={<SecurityPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </Layout>
  );
}

function GuestRoute() {
  return <ErrorBoundary fallbackTitle="Guest App Error">
    <GuestProvider><GuestMobileApp /></GuestProvider>
  </ErrorBoundary>;
}

export default function App() {
  return <BrowserRouter>
    <Routes>
      <Route path="/guest/*" element={<GuestRoute />} />
      <Route path="/*" element={
        <ErrorBoundary fallbackTitle="Staff Dashboard Error">
          <AuthProvider><CurrencyProvider><AppRoutes /></CurrencyProvider></AuthProvider>
        </ErrorBoundary>
      } />
    </Routes>
  </BrowserRouter>;
}
