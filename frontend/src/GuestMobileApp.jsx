import React, { useState, useEffect, useCallback, createContext, useContext } from "react";
import { GuestDigitalKey, GuestRoomControls, GuestExperiences } from "./GuestRoomFeatures";
import {
  Crown, KeyRound, BedDouble, Clock3, Star, Phone, Mail, MapPin, Wifi,
  ChevronRight, ChevronLeft, CheckCircle2, XCircle, AlertTriangle, Plus,
  Minus, Send, Heart, UtensilsCrossed, Flower2, MessageSquareText, LogOut,
  CreditCard, Receipt, Info, Users, Coffee, Car, Sparkles, Bell, Moon, Sun,
  User, Home, ShoppingCart, Calendar, Dumbbell, Waves, Utensils, Globe, Settings, Lock, Unlock, Thermometer, Tv, Lightbulb, Fan, Power, Eye, QrCode
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════
// GUEST CONTEXT
// ═══════════════════════════════════════════════════════════════════
const API = "/api";
const GuestContext = createContext(null);
function useGuest() { return useContext(GuestContext); }

function GuestProvider({ children }) {
  const [guest, setGuest] = useState(() => { try { return JSON.parse(localStorage.getItem("rhosam_guest") || "null"); } catch { return null; } });
  const [reservation, setReservation] = useState(() => { try { return JSON.parse(localStorage.getItem("rhosam_guest_resv") || "null"); } catch { return null; } });
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => { localStorage.removeItem("rhosam_guest_token"); localStorage.removeItem("rhosam_guest"); localStorage.removeItem("rhosam_guest_resv"); setGuest(null); setReservation(null); }, []);

  const request = useCallback(async (path, opts = {}) => {
    const token = localStorage.getItem("rhosam_guest_token");
    const r = await fetch(`${API}${path}`, { ...opts, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) } });
    if (r.status === 401) logout();
    const t = await r.text(); let d = {}; if (t) try { d = JSON.parse(t); } catch { throw new Error(`Non-JSON (${r.status})`); }
    if (!r.ok) throw new Error(d.message || `Request failed (${r.status})`);
    return d;
  }, [logout]);

  useEffect(() => {
    const token = localStorage.getItem("rhosam_guest_token");
    if (!token) { setLoading(false); return; }
    request("/guest/stay").then(d => { setReservation(d); }).catch(logout).finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (confirmationNumber, lastName) => {
    const r = await fetch(`${API}/guest/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmationNumber, lastName }) });
    const t = await r.text(); let d = {}; if (t) try { d = JSON.parse(t); } catch { throw new Error(`Server returned non-JSON response (${r.status})`); }
    if (!r.ok) throw new Error(d.message || `Login failed (${r.status})`);
    localStorage.setItem("rhosam_guest_token", d.token);
    localStorage.setItem("rhosam_guest", JSON.stringify(d.guest));
    localStorage.setItem("rhosam_guest_resv", JSON.stringify(d.reservation));
    setGuest(d.guest); setReservation(d.reservation); return d;
  }, []);

  const refreshStay = useCallback(async () => {
    try { const d = await request("/guest/stay"); setReservation(d); localStorage.setItem("rhosam_guest_resv", JSON.stringify(d)); } catch {}
  }, [request]);

  const value = useMemo(() => ({
    guest, reservation, loading, login, logout, request, refreshStay, setReservation,
  }), [guest, reservation, loading]);

  return <GuestContext.Provider value={value}>{children}</GuestContext.Provider>;
}

// ═══════════════════════════════════════════════════════════════════
// SHARED UI
// ═══════════════════════════════════════════════════════════════════
function Toast({ message, type = "success", onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, []);
  const bg = type === "error" ? "bg-rose-500" : type === "info" ? "bg-sky-500" : "bg-emerald-500";
  return <div className={`fixed top-4 left-4 right-4 ${bg} text-white px-4 py-3 rounded-2xl shadow-xl z-50 text-sm font-medium flex items-center gap-2 animate-slide-down`}>
    {type === "error" ? <XCircle size={18}/> : <CheckCircle2 size={18}/>}{message}
  </div>;
}

function MobileNav({ active, onNavigate }) {
  const tabs = [
    { id: "home", label: "Home", icon: Home },
    { id: "key", label: "Key", icon: KeyRound },
    { id: "experiences", label: "Explore", icon: MapPin },
    { id: "services", label: "Dining", icon: UtensilsCrossed },
    { id: "controls", label: "Room", icon: Settings },
  ];
  return <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-navy-900 border-t border-slate-200 dark:border-slate-700 z-40 safe-bottom">
    <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
      {tabs.map(t => <button key={t.id} onClick={() => onNavigate(t.id)} className={`flex flex-col items-center gap-0.5 px-3 py-1 transition ${active === t.id ? "text-brand-500" : "text-slate-400"}`}>
        <t.icon size={20} strokeWidth={active === t.id ? 2.5 : 1.5}/><span className="text-[10px] font-medium">{t.label}</span>
      </button>)}
    </div>
  </nav>;
}

// ═══════════════════════════════════════════════════════════════════
// PUBLIC LANDING PAGE (Visitors before booking)
// ═══════════════════════════════════════════════════════════════════
function PublicLandingPage({ onSwitchToLogin }) {
  const [hotelInfo, setHotelInfo] = useState(null);
  const [roomTypes, setRoomTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showBooking, setShowBooking] = useState(null); // roomType to book
  const [bookingForm, setBookingForm] = useState({ firstName: "", lastName: "", email: "", phone: "", nationality: "", checkIn: "", checkOut: "", adults: 1, children: 0, specialRequests: "" });
  const [bookingResult, setBookingResult] = useState(null);
  const [bookingError, setBookingError] = useState("");
  const [bookingBusy, setBookingBusy] = useState(false);
  const [activeSection, setActiveSection] = useState("hero");
  const [dark, setDark] = useState(false);

  useEffect(() => {
    async function safeFetch(url, fallback) {
      try {
        const r = await fetch(url);
        if (!r.ok) return fallback;
        const t = await r.text(); if (!t) return fallback;
        try { return JSON.parse(t); } catch { return fallback; }
      } catch { return fallback; }
    }
    Promise.all([
      safeFetch("/api/public/hotel-info", {}),
      safeFetch("/api/public/room-types", [])
    ]).then(([info, rooms]) => { setHotelInfo(info); setRoomTypes(rooms); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleBooking(e) {
    e.preventDefault(); setBookingError(""); setBookingBusy(true);
    try {
      const r = await fetch("/api/public/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...bookingForm, roomTypeId: showBooking.id })
      });
      const t = await r.text(); let d = {}; if (t) try { d = JSON.parse(t); } catch { throw new Error(`Server returned non-JSON response (${r.status})`); }
      if (!r.ok) throw new Error(d.message || `Booking failed (${r.status})`);
      setBookingResult(d);
    } catch (err) { setBookingError(err.message); }
    finally { setBookingBusy(false); }
  }

  if (loading) return <div className="min-h-screen bg-gradient-to-br from-navy-950 via-navy-900 to-navy-950 flex items-center justify-center"><div className="text-brand-300 flex items-center gap-2"><div className="h-5 w-5 border-2 border-brand-400 border-t-transparent rounded-full animate-spin"/> Loading…</div></div>;

  const amenityIcons = { wifi: Wifi, utensils: UtensilsCrossed, spa: Flower2, pool: Waves, gym: Dumbbell, concierge: Bell };

  // Booking confirmation screen
  if (bookingResult) {
    return <div className="min-h-screen bg-gradient-to-br from-navy-950 via-navy-900 to-navy-950 flex flex-col items-center justify-center p-6 text-center">
      <div className="h-20 w-20 rounded-full bg-emerald-500/20 grid place-items-center mb-6"><CheckCircle2 size={40} className="text-emerald-400"/></div>
      <h1 className="text-2xl font-bold text-white mb-2">Booking Confirmed!</h1>
      <p className="text-slate-400 mb-6">Your reservation has been successfully created.</p>
      <div className="bg-navy-900/80 rounded-2xl p-6 border border-white/10 w-full max-w-sm space-y-3">
        <div className="flex justify-between text-sm"><span className="text-slate-400">Confirmation #</span><span className="text-brand-300 font-mono font-bold text-lg">{bookingResult.confirmationNumber}</span></div>
        <div className="flex justify-between text-sm"><span className="text-slate-400">Check-in</span><span className="text-white">{bookingResult.reservation.checkIn}</span></div>
        <div className="flex justify-between text-sm"><span className="text-slate-400">Check-out</span><span className="text-white">{bookingResult.reservation.checkOut}</span></div>
        <div className="flex justify-between text-sm"><span className="text-slate-400">Total</span><span className="text-white font-semibold">₦{Number(bookingResult.reservation.totalAmount).toLocaleString()}</span></div>
      </div>
      <div className="bg-navy-800/50 rounded-2xl p-4 border border-brand-400/20 w-full max-w-sm mt-4">
        <p className="text-brand-300 text-sm font-medium mb-2">📱 How to access your stay:</p>
        <p className="text-slate-400 text-xs">Use confirmation number <span className="text-white font-mono">{bookingResult.confirmationNumber}</span> and your last name to sign in at <span className="text-brand-300">/guest</span></p>
      </div>
      <button onClick={() => { setBookingResult(null); setShowBooking(null); setBookingForm({ firstName: "", lastName: "", email: "", phone: "", nationality: "", checkIn: "", checkOut: "", adults: 1, children: 0, specialRequests: "" }); }} className="mt-6 text-brand-300 text-sm hover:underline">← Back to rooms</button>
      <button onClick={onSwitchToLogin} className="mt-2 text-slate-500 text-xs hover:text-slate-300">Already have a booking? Sign in</button>
    </div>;
  }

  // Booking form modal
  if (showBooking) {
    const nights = bookingForm.checkIn && bookingForm.checkOut ? Math.max(1, Math.ceil((new Date(bookingForm.checkOut) - new Date(bookingForm.checkIn)) / 86400000)) : 0;
    const total = nights * Number(showBooking.base_rate);
    return <div className="min-h-screen bg-gradient-to-br from-navy-950 via-navy-900 to-navy-950 p-6">
      <button onClick={() => setShowBooking(null)} className="text-slate-400 text-sm mb-6 flex items-center gap-1"><ChevronLeft size={16}/> Back to rooms</button>
      <div className="max-w-sm mx-auto">
        <div className="text-center mb-6">
          <h2 className="text-xl font-bold text-white">Book {showBooking.name}</h2>
          <p className="text-slate-400 text-sm mt-1">₦{Number(showBooking.base_rate).toLocaleString()} / night</p>
        </div>
        <form onSubmit={handleBooking} className="space-y-4">
          {bookingError && <div className="bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm p-3 rounded-2xl">{bookingError}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-slate-400 mb-1 block">First Name *</label><input className="w-full h-10 px-3 bg-navy-950/80 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-brand-400/50" value={bookingForm.firstName} onChange={e => setBookingForm({...bookingForm, firstName: e.target.value})} required/></div>
            <div><label className="text-xs text-slate-400 mb-1 block">Last Name *</label><input className="w-full h-10 px-3 bg-navy-950/80 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-brand-400/50" value={bookingForm.lastName} onChange={e => setBookingForm({...bookingForm, lastName: e.target.value})} required/></div>
          </div>
          <div><label className="text-xs text-slate-400 mb-1 block">Email *</label><input type="email" className="w-full h-10 px-3 bg-navy-950/80 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-brand-400/50" value={bookingForm.email} onChange={e => setBookingForm({...bookingForm, email: e.target.value})} required/></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-slate-400 mb-1 block">Phone</label><input className="w-full h-10 px-3 bg-navy-950/80 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-brand-400/50" value={bookingForm.phone} onChange={e => setBookingForm({...bookingForm, phone: e.target.value})}/></div>
            <div><label className="text-xs text-slate-400 mb-1 block">Nationality</label><input className="w-full h-10 px-3 bg-navy-950/80 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-brand-400/50" value={bookingForm.nationality} onChange={e => setBookingForm({...bookingForm, nationality: e.target.value})}/></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-slate-400 mb-1 block">Check-in *</label><input type="date" className="w-full h-10 px-3 bg-navy-950/80 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-brand-400/50" value={bookingForm.checkIn} onChange={e => setBookingForm({...bookingForm, checkIn: e.target.value})} required/></div>
            <div><label className="text-xs text-slate-400 mb-1 block">Check-out *</label><input type="date" className="w-full h-10 px-3 bg-navy-950/80 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-brand-400/50" value={bookingForm.checkOut} onChange={e => setBookingForm({...bookingForm, checkOut: e.target.value})} required/></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-slate-400 mb-1 block">Adults</label><div className="flex items-center gap-2"><button type="button" className="h-10 w-10 rounded-xl bg-navy-800 border border-slate-700 text-white flex items-center justify-center" onClick={() => setBookingForm({...bookingForm, adults: Math.max(1, bookingForm.adults - 1)})}><Minus size={14}/></button><span className="text-white font-medium w-8 text-center">{bookingForm.adults}</span><button type="button" className="h-10 w-10 rounded-xl bg-navy-800 border border-slate-700 text-white flex items-center justify-center" onClick={() => setBookingForm({...bookingForm, adults: Math.min(10, bookingForm.adults + 1)})}><Plus size={14}/></button></div></div>
            <div><label className="text-xs text-slate-400 mb-1 block">Children</label><div className="flex items-center gap-2"><button type="button" className="h-10 w-10 rounded-xl bg-navy-800 border border-slate-700 text-white flex items-center justify-center" onClick={() => setBookingForm({...bookingForm, children: Math.max(0, bookingForm.children - 1)})}><Minus size={14}/></button><span className="text-white font-medium w-8 text-center">{bookingForm.children}</span><button type="button" className="h-10 w-10 rounded-xl bg-navy-800 border border-slate-700 text-white flex items-center justify-center" onClick={() => setBookingForm({...bookingForm, children: Math.min(6, bookingForm.children + 1)})}><Plus size={14}/></button></div></div>
          </div>
          <div><label className="text-xs text-slate-400 mb-1 block">Special Requests</label><textarea className="w-full h-20 px-3 bg-navy-950/80 border border-slate-700 rounded-xl text-white text-sm focus:ring-2 focus:ring-brand-400/50 resize-none" value={bookingForm.specialRequests} onChange={e => setBookingForm({...bookingForm, specialRequests: e.target.value})} placeholder="Any preferences or requests…"/></div>
          {nights > 0 && <div className="bg-navy-800/50 rounded-xl p-4 border border-white/5 space-y-2">
            <div className="flex justify-between text-sm"><span className="text-slate-400">{nights} night{nights > 1 ? 's' : ''} × ₦{Number(showBooking.base_rate).toLocaleString()}</span><span className="text-white font-semibold">₦{total.toLocaleString()}</span></div>
          </div>}
          <button type="submit" disabled={bookingBusy} className="w-full h-12 rounded-xl bg-gradient-to-r from-brand-400 to-brand-500 hover:from-brand-300 hover:to-brand-400 text-navy-950 font-semibold text-sm transition disabled:opacity-50">
            {bookingBusy ? "Booking…" : "Confirm Booking"}
          </button>
        </form>
      </div>
    </div>;
  }

  // Main landing page
  return <div className="min-h-screen bg-gradient-to-br from-navy-950 via-navy-900 to-navy-950">
    {/* Header */}
    <div className="flex items-center justify-between p-4">
      <div className="flex items-center gap-2">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-brand-300 to-brand-500 grid place-items-center text-navy-950"><Crown size={20}/></div>
        <div><h1 className="text-white font-bold text-sm">RHoSAM Hotel</h1><p className="text-brand-300 text-[10px] tracking-[.2em]">HOTEL & SUITES</p></div>
      </div>
      <div className="flex items-center gap-2">
        <button className="p-2 rounded-xl bg-white/10 text-white/60" onClick={() => setDark(!dark)}>{dark ? <Sun size={16}/> : <Moon size={16}/>}</button>
        <button onClick={onSwitchToLogin} className="px-3 py-1.5 rounded-xl bg-brand-400/10 text-brand-300 text-xs font-medium border border-brand-400/20">Sign In</button>
      </div>
    </div>

    {/* Hero */}
    <div className="px-6 py-12 text-center">
      <h2 className="text-3xl font-bold text-white mb-3">Welcome to<br/><span className="text-brand-300">RHoSAM Hotel</span></h2>
      <p className="text-slate-400 text-sm max-w-xs mx-auto">{hotelInfo?.description?.slice(0, 120) || 'Experience world-class hospitality and luxury accommodations.'}…</p>
    </div>

    {/* Features */}
    {hotelInfo?.features && <div className="px-4 pb-8">
      <div className="grid grid-cols-3 gap-3">
        {hotelInfo.features.map((f, i) => {
          const Icon = amenityIcons[f.icon] || Star;
          return <div key={i} className="bg-navy-900/50 rounded-xl p-3 border border-white/5 text-center">
            <Icon size={20} className="text-brand-300 mx-auto mb-1.5"/>
            <p className="text-white text-[11px] font-medium leading-tight">{f.title}</p>
          </div>;
        })}
      </div>
    </div>}

    {/* Room Types */}
    <div className="px-4 pb-24">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white">Rooms & Suites</h3>
        <span className="text-xs text-slate-500">{roomTypes.length} types</span>
      </div>
      <div className="space-y-4">
        {roomTypes.map(rt => <div key={rt.id} className="bg-navy-900/80 rounded-2xl border border-white/5 overflow-hidden">
          <div className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="text-white font-semibold">{rt.name}</h4>
                <p className="text-slate-400 text-xs mt-1 line-clamp-2">{rt.description || 'Premium accommodation with modern amenities.'}</p>
              </div>
              <div className="text-right">
                <p className="text-brand-300 font-bold text-lg">₦{Number(rt.base_rate).toLocaleString()}</p>
                <p className="text-slate-500 text-[10px]">/night</p>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-3 text-xs text-slate-400">
              <span className="flex items-center gap-1"><Users size={12}/> Max {rt.max_occupancy}</span>
              <span className="flex items-center gap-1"><BedDouble size={12}/> {rt.available_rooms || 0} available</span>
            </div>
            {rt.amenities && rt.amenities.length > 0 && <div className="flex flex-wrap gap-1.5 mt-3">
              {rt.amenities.slice(0, 4).map((a, i) => <span key={i} className="px-2 py-0.5 bg-white/5 rounded-full text-[10px] text-slate-400">{a}</span>)}
              {rt.amenities.length > 4 && <span className="px-2 py-0.5 bg-white/5 rounded-full text-[10px] text-slate-400">+{rt.amenities.length - 4}</span>}
            </div>}
            <button onClick={() => { setShowBooking(rt); setBookingForm(prev => ({...prev, firstName: "", lastName: "", email: "", phone: "", nationality: "", specialRequests: "" })); }} className="w-full mt-4 h-10 rounded-xl bg-gradient-to-r from-brand-400 to-brand-500 hover:from-brand-300 hover:to-brand-400 text-navy-950 font-semibold text-sm transition">
              Book Now — ₦{Number(rt.base_rate).toLocaleString()}/night
            </button>
          </div>
        </div>)}
      </div>

      {/* Sign-in CTA */}
      <div className="mt-8 bg-navy-900/50 rounded-2xl p-5 border border-white/5 text-center">
        <KeyRound size={24} className="text-brand-300 mx-auto mb-2"/>
        <h4 className="text-white font-semibold text-sm mb-1">Already have a booking?</h4>
        <p className="text-slate-400 text-xs mb-3">Sign in with your confirmation number to manage your stay.</p>
        <button onClick={onSwitchToLogin} className="px-6 py-2 rounded-xl bg-white/10 text-white text-sm font-medium border border-white/10 hover:bg-white/20 transition">
          Guest Sign In
        </button>
      </div>

      {/* Contact */}
      <div className="mt-6 text-center space-y-2 pb-4">
        <p className="text-slate-500 text-xs">{hotelInfo?.address}</p>
        <div className="flex items-center justify-center gap-4 text-xs">
          <a href={`tel:${hotelInfo?.phone}`} className="text-brand-300 flex items-center gap-1"><Phone size={12}/> {hotelInfo?.phone}</a>
          <a href={`mailto:${hotelInfo?.email}`} className="text-brand-300 flex items-center gap-1"><Mail size={12}/> Email</a>
        </div>
        <p className="text-slate-600 text-[10px]">© {new Date().getFullYear()} RHoSAM Hotel & Suites. All rights reserved.</p>
      </div>
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════
// LOGIN SCREEN
// ═══════════════════════════════════════════════════════════════════
function GuestLogin({ onSwitchToLanding }) {
  const { login } = useGuest();
  const [conf, setConf] = useState(""); const [lastName, setLastName] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [dark, setDark] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault(); setError(""); setBusy(true);
    try { await login(conf, lastName); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <div className={`min-h-screen ${dark ? "dark" : ""} bg-gradient-to-br from-navy-950 via-navy-900 to-navy-950 flex flex-col`}>
    <div className="flex-1 flex flex-col items-center justify-center p-6">
      <div className="absolute top-4 right-4"><button className="p-2 rounded-xl bg-white/10 text-white/60" onClick={() => setDark(!dark)}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button></div>
      <div className="text-center mb-8">
        <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-brand-300 to-brand-500 grid place-items-center text-navy-950 mx-auto mb-4 shadow-xl shadow-brand-400/30"><Crown size={32}/></div>
        <h1 className="text-2xl font-bold text-white">RHoSAM Hotel</h1>
        <p className="text-brand-300 text-xs tracking-[.3em] mt-1">HOTEL & SUITES</p>
        <p className="text-slate-400 text-sm mt-3">Welcome, Guest</p>
      </div>
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        {error && <div className="bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm p-3 rounded-2xl flex items-center gap-2"><AlertTriangle size={16}/>{error}</div>}
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Confirmation Number</label>
          <input className="w-full h-12 px-4 bg-navy-950/80 border border-slate-700 rounded-2xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/50 placeholder-slate-600" placeholder="e.g. RH-XXXXXXXX" value={conf} onChange={e => setConf(e.target.value)} required autoFocus/>
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Last Name</label>
          <input className="w-full h-12 px-4 bg-navy-950/80 border border-slate-700 rounded-2xl text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-400/50 placeholder-slate-600" placeholder="As on your booking" value={lastName} onChange={e => setLastName(e.target.value)} required/>
        </div>
        <button type="submit" disabled={busy} className="w-full h-12 rounded-2xl bg-gradient-to-r from-brand-400 to-brand-500 text-navy-950 font-semibold text-sm transition disabled:opacity-50 shadow-lg shadow-brand-400/20">
          {busy ? "Signing in…" : "Access My Stay"}
        </button>
      </form>
      <p className="text-slate-600 text-xs mt-6 text-center max-w-xs">Find your confirmation number in your booking email from RHoSAM Hotel.</p>
      <button onClick={onSwitchToLanding} className="mt-4 text-brand-300 text-sm hover:underline flex items-center gap-1"><Globe size={14}/> Browse Rooms & Book</button>
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════
// HOME SCREEN
// ═══════════════════════════════════════════════════════════════════
function GuestHome() {
  const { guest, reservation, request, refreshStay, logout } = useGuest();
  const [hotelInfo, setHotelInfo] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => { request("/guest/hotel-info").then(setHotelInfo).catch(() => {}); }, []);

  const daysLeft = reservation ? Math.max(0, Math.ceil((new Date(reservation.check_out) - new Date()) / 86400000)) : 0;
  const isCheckedIn = reservation?.status === "CHECKED_IN";
  const isConfirmed = reservation?.status === "CONFIRMED";
  const isCompleted = reservation?.status === "CHECKED_OUT";

  async function handleCheckIn() {
    try { await request("/guest/check-in", { method: "POST" }); await refreshStay(); setToast({ msg: "Checked in successfully! Welcome to RHoSAM.", type: "success" }); } catch (e) { setToast({ msg: e.message, type: "error" }); }
  }

  async function handleCheckOut() {
    try { await request("/guest/check-out", { method: "POST" }); await refreshStay(); setToast({ msg: "Checked out. Thank you for staying with us!", type: "success" }); } catch (e) { setToast({ msg: e.message, type: "error" }); }
  }

  return <div className="pb-20">
    {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)}/>}
    {/* Hero */}
    <div className="bg-gradient-to-br from-navy-900 to-navy-800 text-white p-6 pb-8 rounded-b-3xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2"><div className="h-8 w-8 rounded-lg bg-gradient-to-br from-brand-300 to-brand-500 grid place-items-center text-navy-950"><Crown size={16}/></div><span className="text-sm font-semibold tracking-wide">RHoSAM</span></div>
        <button className="p-2 rounded-xl bg-white/10 text-white/60" onClick={logout}><LogOut size={18}/></button>
      </div>
      <div className="mb-4">
        <p className="text-brand-300 text-sm">Welcome back,</p>
        <h2 className="text-2xl font-bold">{guest?.firstName} {guest?.lastName}</h2>
        {guest?.loyaltyTier && <div className="flex items-center gap-1 mt-1"><Star size={14} className="text-brand-400" fill="currentColor"/><span className="text-xs text-brand-300">{guest.loyaltyTier} Member</span></div>}
      </div>

      {/* Room Card */}
      {reservation && <div className="bg-white/10 backdrop-blur rounded-2xl p-4 border border-white/10">
        <div className="flex items-center justify-between mb-3">
          <div><div className="text-xs text-slate-400">Your Room</div><div className="text-xl font-bold">{reservation.roomNumber || "—"}</div></div>
          <div className="text-right"><div className="text-xs text-slate-400">Type</div><div className="text-sm font-medium">{reservation.roomType || "—"}</div></div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="bg-white/5 rounded-xl p-2"><div className="text-slate-400">Check-in</div><div className="font-semibold mt-0.5">{reservation.checkIn?.slice(5)}</div></div>
          <div className="bg-white/5 rounded-xl p-2"><div className="text-slate-400">Check-out</div><div className="font-semibold mt-0.5">{reservation.checkOut?.slice(5)}</div></div>
          <div className="bg-white/5 rounded-xl p-2"><div className="text-slate-400">Nights</div><div className="font-semibold mt-0.5">{daysLeft > 0 ? `${daysLeft} left` : "Done"}</div></div>
        </div>
        {/* Digital Key */}
        {isCheckedIn && <div className="mt-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-emerald-500/20 grid place-items-center"><KeyRound size={20} className="text-emerald-400"/></div>
          <div><div className="text-sm font-semibold text-emerald-300">Digital Key Active</div><div className="text-xs text-emerald-400/70">Room {reservation.roomNumber}</div></div>
        </div>}
      </div>}
    </div>

    {/* Quick Actions */}
    <div className="px-4 -mt-4 relative z-10">
      <div className="grid grid-cols-2 gap-3 mb-6">
        {isConfirmed && <button onClick={handleCheckIn} className="bg-white dark:bg-navy-800 rounded-2xl p-4 shadow-lg border border-slate-100 dark:border-slate-700 text-left hover:shadow-xl transition">
          <div className="h-10 w-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 grid place-items-center mb-3"><KeyRound size={20} className="text-emerald-600 dark:text-emerald-400"/></div>
          <div className="font-semibold text-sm">Digital Check-in</div><div className="text-xs text-slate-500 mt-0.5">Go to your room</div>
        </button>}
        {isCheckedIn && <button onClick={handleCheckOut} className="bg-white dark:bg-navy-800 rounded-2xl p-4 shadow-lg border border-slate-100 dark:border-slate-700 text-left hover:shadow-xl transition">
          <div className="h-10 w-10 rounded-xl bg-sky-100 dark:bg-sky-900/30 grid place-items-center mb-3"><LogOut size={20} className="text-sky-600 dark:text-sky-400"/></div>
          <div className="font-semibold text-sm">Check Out</div><div className="text-xs text-slate-500 mt-0.5">Before 12:00 PM</div>
        </button>}
        <button className="bg-white dark:bg-navy-800 rounded-2xl p-4 shadow-lg border border-slate-100 dark:border-slate-700 text-left hover:shadow-xl transition" onClick={() => window.__guestNavigate?.("services")}>
          <div className="h-10 w-10 rounded-xl bg-brand-100 dark:bg-brand-900/30 grid place-items-center mb-3"><UtensilsCrossed size={20} className="text-brand-600 dark:text-brand-400"/></div>
          <div className="font-semibold text-sm">Room Service</div><div className="text-xs text-slate-500 mt-0.5">Order to your room</div>
        </button>
        <button className="bg-white dark:bg-navy-800 rounded-2xl p-4 shadow-lg border border-slate-100 dark:border-slate-700 text-left hover:shadow-xl transition" onClick={() => window.__guestNavigate?.("spa")}>
          <div className="h-10 w-10 rounded-xl bg-violet-100 dark:bg-violet-900/30 grid place-items-center mb-3"><Flower2 size={20} className="text-violet-600 dark:text-violet-400"/></div>
          <div className="font-semibold text-sm">Book Spa</div><div className="text-xs text-slate-500 mt-0.5">Wellness & relaxation</div>
        </button>
      </div>

      {/* Hotel Services */}
      {hotelInfo && <div className="mb-6">
        <h3 className="font-semibold text-lg mb-3">Hotel Services</h3>
        <div className="space-y-2">
          {hotelInfo.hotel?.restaurants?.map((r, i) => <div key={i} className="bg-white dark:bg-navy-800 rounded-2xl p-4 flex items-center gap-3 shadow-sm">
            <div className="h-10 w-10 rounded-xl bg-brand-100 dark:bg-brand-900/30 grid place-items-center shrink-0"><Utensils size={18} className="text-brand-600"/></div>
            <div className="flex-1"><div className="font-medium text-sm">{r.name}</div><div className="text-xs text-slate-500">{r.cuisine} · {r.hours}</div></div>
            <ChevronRight size={16} className="text-slate-300"/>
          </div>)}
          {hotelInfo.hotel?.spa && <div className="bg-white dark:bg-navy-800 rounded-2xl p-4 flex items-center gap-3 shadow-sm">
            <div className="h-10 w-10 rounded-xl bg-violet-100 dark:bg-violet-900/30 grid place-items-center shrink-0"><Flower2 size={18} className="text-violet-600"/></div>
            <div className="flex-1"><div className="font-medium text-sm">{hotelInfo.hotel.spa.name}</div><div className="text-xs text-slate-500">{hotelInfo.hotel.spa.hours}</div></div>
            <ChevronRight size={16} className="text-slate-300"/>
          </div>}
          {hotelInfo.hotel?.pool && <div className="bg-white dark:bg-navy-800 rounded-2xl p-4 flex items-center gap-3 shadow-sm">
            <div className="h-10 w-10 rounded-xl bg-sky-100 dark:bg-sky-900/30 grid place-items-center shrink-0"><Waves size={18} className="text-sky-600"/></div>
            <div className="flex-1"><div className="font-medium text-sm">{hotelInfo.hotel.pool.name}</div><div className="text-xs text-slate-500">{hotelInfo.hotel.pool.hours}</div></div>
            <ChevronRight size={16} className="text-slate-300"/>
          </div>}
          {hotelInfo.hotel?.wifi && <div className="bg-white dark:bg-navy-800 rounded-2xl p-4 flex items-center gap-3 shadow-sm">
            <div className="h-10 w-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 grid place-items-center shrink-0"><Wifi size={18} className="text-emerald-600"/></div>
            <div className="flex-1"><div className="font-medium text-sm">WiFi</div><div className="text-xs text-slate-500">Network: {hotelInfo.hotel.wifi.network} · Password: {hotelInfo.hotel.wifi.password}</div></div>
          </div>}
        </div>
      </div>}

      {/* Quick Contacts */}
      {hotelInfo && <div className="mb-6">
        <h3 className="font-semibold text-lg mb-3">Quick Contacts</h3>
        <div className="grid grid-cols-2 gap-3">
          <a href={`tel:${hotelInfo.hotel?.reception}`} className="bg-white dark:bg-navy-800 rounded-2xl p-4 shadow-sm flex items-center gap-3"><div className="h-10 w-10 rounded-xl bg-sky-100 dark:bg-sky-900/30 grid place-items-center"><Phone size={18} className="text-sky-600"/></div><div><div className="text-sm font-medium">Reception</div><div className="text-xs text-slate-500">24/7</div></div></a>
          <a href={`tel:${hotelInfo.hotel?.concierge}`} className="bg-white dark:bg-navy-800 rounded-2xl p-4 shadow-sm flex items-center gap-3"><div className="h-10 w-10 rounded-xl bg-brand-100 dark:bg-brand-900/30 grid place-items-center"><Sparkles size={18} className="text-brand-600"/></div><div><div className="text-sm font-medium">Concierge</div><div className="text-xs text-slate-500">Assistance</div></div></a>
        </div>
      </div>}
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════
// ROOM SERVICE SCREEN
// ═══════════════════════════════════════════════════════════════════
function GuestRoomService() {
  const { request } = useGuest();
  const [menu, setMenu] = useState([]); const [orders, setOrders] = useState([]); const [activeTab, setActiveTab] = useState("menu");
  const [cart, setCart] = useState([]); const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    Promise.all([request("/guest/menu"), request("/guest/room-service")]).then(([m, o]) => { setMenu(m); setOrders(o); }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const categories = [...new Set(menu.map(m => m.category))];
  const cartTotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

  function addToCart(item) {
    setCart(prev => {
      const existing = prev.find(c => c.menuItemId === item.id);
      if (existing) return prev.map(c => c.menuItemId === item.id ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { menuItemId: item.id, name: item.name, unitPrice: item.price, quantity: 1, specialInstructions: "" }];
    });
  }

  function updateCartQty(menuItemId, delta) {
    setCart(prev => prev.map(c => c.menuItemId === menuItemId ? { ...c, quantity: Math.max(0, c.quantity + delta) } : c).filter(c => c.quantity > 0));
  }

  async function placeOrder() {
    try {
      await request("/guest/room-service", { method: "POST", body: JSON.stringify({ items: cart }) });
      setCart([]); setToast({ msg: "Room service order placed! Preparing now.", type: "success" });
      const o = await request("/guest/room-service"); setOrders(o);
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
  }

  return <div className="pb-20">
    {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)}/>}
    <div className="bg-gradient-to-br from-navy-900 to-navy-800 text-white p-6 pb-8 rounded-b-3xl">
      <h1 className="text-xl font-bold mb-1">Room Service</h1>
      <p className="text-sm text-slate-400">Dine in the comfort of your room</p>
      <div className="flex gap-2 mt-4">
        <button className={`px-4 py-2 rounded-xl text-sm font-medium transition ${activeTab === "menu" ? "bg-brand-400 text-navy-950" : "bg-white/10 text-white/60"}`} onClick={() => setActiveTab("menu")}>Menu</button>
        <button className={`px-4 py-2 rounded-xl text-sm font-medium transition ${activeTab === "orders" ? "bg-brand-400 text-navy-950" : "bg-white/10 text-white/60"}`} onClick={() => setActiveTab("orders")}>My Orders ({orders.filter(o => o.status !== "COMPLETED").length})</button>
        {cart.length > 0 && <button className={`px-4 py-2 rounded-xl text-sm font-medium transition ${activeTab === "cart" ? "bg-brand-400 text-navy-950" : "bg-white/10 text-white/60"}`} onClick={() => setActiveTab("cart")}>Cart ({cart.length})</button>}
      </div>
    </div>

    <div className="px-4 mt-4">
      {activeTab === "menu" && categories.map(cat => <div key={cat} className="mb-6">
        <h3 className="font-semibold mb-3">{cat}</h3>
        <div className="space-y-3">{menu.filter(m => m.category === cat).map(item => <div key={item.id} className="bg-white dark:bg-navy-800 rounded-2xl p-4 shadow-sm">
          <div className="flex justify-between items-start">
            <div className="flex-1"><div className="font-medium">{item.name}</div><div className="text-xs text-slate-500 mt-1">{item.description}</div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-sm font-bold text-brand-600">₦{Number(item.price).toLocaleString()}</span>
                {item.is_vegetarian && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">Veg</span>}
                {item.allergens?.length > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">Allergens</span>}
              </div>
            </div>
            <div className="ml-3">
              {cart.find(c => c.menuItemId === item.id) ? (
                <div className="flex items-center gap-2 bg-brand-50 dark:bg-brand-900/20 rounded-xl px-2 py-1">
                  <button className="h-7 w-7 rounded-lg bg-white dark:bg-navy-800 shadow flex items-center justify-center" onClick={() => updateCartQty(item.id, -1)}><Minus size={14}/></button>
                  <span className="text-sm font-semibold w-6 text-center">{cart.find(c => c.menuItemId === item.id)?.quantity}</span>
                  <button className="h-7 w-7 rounded-lg bg-brand-400 text-navy-950 shadow flex items-center justify-center" onClick={() => updateCartQty(item.id, 1)}><Plus size={14}/></button>
                </div>
              ) : <button className="h-9 px-4 rounded-xl bg-navy-900 dark:bg-brand-400 text-white dark:text-navy-950 text-sm font-medium" onClick={() => addToCart(item)}><Plus size={14}/></button>}
            </div>
          </div>
        </div>)}</div>
      </div>)}

      {activeTab === "cart" && <div>
        {cart.length === 0 ? <div className="text-center py-12 text-slate-400"><ShoppingCart size={40} className="mx-auto mb-3 opacity-50"/><p>Your cart is empty</p></div> : <>
          <div className="space-y-3 mb-4">{cart.map(item => <div key={item.menuItemId} className="bg-white dark:bg-navy-800 rounded-2xl p-4 shadow-sm flex items-center justify-between">
            <div><div className="font-medium text-sm">{item.name}</div><div className="text-xs text-slate-500">₦{Number(item.unitPrice).toLocaleString()} each</div></div>
            <div className="flex items-center gap-2">
              <button className="h-7 w-7 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center" onClick={() => updateCartQty(item.menuItemId, -1)}><Minus size={14}/></button>
              <span className="text-sm font-semibold w-6 text-center">{item.quantity}</span>
              <button className="h-7 w-7 rounded-lg bg-brand-400 text-navy-950 flex items-center justify-center" onClick={() => updateCartQty(item.menuItemId, 1)}><Plus size={14}/></button>
            </div>
          </div>)}</div>
          <div className="bg-white dark:bg-navy-800 rounded-2xl p-4 shadow-sm mb-4">
            <div className="flex justify-between font-semibold"><span>Total</span><span className="text-brand-600">₦{cartTotal.toLocaleString()}</span></div>
            <div className="text-xs text-slate-500 mt-1">Charged to your room folio</div>
          </div>
          <button className="w-full h-12 rounded-2xl bg-gradient-to-r from-brand-400 to-brand-500 text-navy-950 font-semibold text-sm shadow-lg shadow-brand-400/20" onClick={placeOrder}>Place Order — ₦{cartTotal.toLocaleString()}</button>
        </>}
      </div>}

      {activeTab === "orders" && <div className="space-y-3">
        {orders.length === 0 ? <div className="text-center py-12 text-slate-400"><UtensilsCrossed size={40} className="mx-auto mb-3 opacity-50"/><p>No orders yet</p></div> :
          orders.map(o => <div key={o.id} className="bg-white dark:bg-navy-800 rounded-2xl p-4 shadow-sm">
            <div className="flex justify-between items-start mb-2">
              <div className="text-sm font-medium">Order #{o.id}</div>
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${o.status === "COMPLETED" ? "bg-emerald-100 text-emerald-700" : o.status === "IN_PROGRESS" ? "bg-sky-100 text-sky-700" : "bg-amber-100 text-amber-700"}`}>{o.status}</span>
            </div>
            <div className="text-xs text-slate-500 mb-2">{o.items?.map(i => `${i.qty}x ${i.name}`).join(", ")}</div>
            <div className="flex justify-between text-sm"><span className="font-semibold">₦{Number(o.total_amount || 0).toLocaleString()}</span><span className="text-xs text-slate-400">{new Date(o.created_at).toLocaleTimeString()}</span></div>
          </div>)}
      </div>}
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════
// SPA SCREEN
// ═══════════════════════════════════════════════════════════════════
function GuestSpa() {
  const { request } = useGuest();
  const [services, setServices] = useState([]); const [appointments, setAppointments] = useState([]);
  const [activeTab, setActiveTab] = useState("services"); const [loading, setLoading] = useState(true);
  const [showBook, setShowBook] = useState(null); const [bookForm, setBookForm] = useState({ date: "", time: "10:00", notes: "" });
  const [toast, setToast] = useState(null);

  useEffect(() => {
    Promise.all([request("/guest/spa/services"), request("/guest/spa/my-appointments")]).then(([s, a]) => { setServices(s); setAppointments(a); }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const categories = [...new Set(services.map(s => s.category))];

  async function handleBook() {
    if (!bookForm.date) { setToast({ msg: "Please select a date", type: "error" }); return; }
    try {
      await request("/guest/spa/book", { method: "POST", body: JSON.stringify({ serviceId: showBook.id, appointmentDate: bookForm.date, appointmentTime: bookForm.time, notes: bookForm.notes }) });
      setShowBook(null); setBookForm({ date: "", time: "10:00", notes: "" });
      setToast({ msg: "Spa appointment booked!", type: "success" });
      const a = await request("/guest/spa/my-appointments"); setAppointments(a);
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
  }

  return <div className="pb-20">
    {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)}/>}
    <div className="bg-gradient-to-br from-violet-900 to-purple-800 text-white p-6 pb-8 rounded-b-3xl">
      <h1 className="text-xl font-bold mb-1">Spa & Wellness</h1>
      <p className="text-sm text-purple-200">Indulge in luxury treatments</p>
      <div className="flex gap-2 mt-4">
        <button className={`px-4 py-2 rounded-xl text-sm font-medium transition ${activeTab === "services" ? "bg-white text-purple-900" : "bg-white/10 text-white/60"}`} onClick={() => setActiveTab("services")}>Services</button>
        <button className={`px-4 py-2 rounded-xl text-sm font-medium transition ${activeTab === "appointments" ? "bg-white text-purple-900" : "bg-white/10 text-white/60"}`} onClick={() => setActiveTab("appointments")}>My Bookings ({appointments.length})</button>
      </div>
    </div>

    <div className="px-4 mt-4">
      {activeTab === "services" && categories.map(cat => <div key={cat} className="mb-6">
        <h3 className="font-semibold mb-3">{cat}</h3>
        <div className="space-y-3">{services.filter(s => s.category === cat).map(svc => <div key={svc.id} className="bg-white dark:bg-navy-800 rounded-2xl p-4 shadow-sm">
          <div className="flex justify-between items-start">
            <div className="flex-1"><div className="font-medium">{svc.name}</div><div className="text-xs text-slate-500 mt-1">{svc.description}</div>
              <div className="flex items-center gap-3 mt-2"><span className="text-xs text-slate-500 flex items-center gap-1"><Clock3 size={12}/> {svc.duration_minutes} min</span><span className="text-sm font-bold text-violet-600">₦{Number(svc.price).toLocaleString()}</span></div>
            </div>
            <button className="h-9 px-4 rounded-xl bg-violet-600 text-white text-sm font-medium ml-3" onClick={() => setShowBook(svc)}>Book</button>
          </div>
        </div>)}</div>
      </div>)}

      {activeTab === "appointments" && <div className="space-y-3">
        {appointments.length === 0 ? <div className="text-center py-12 text-slate-400"><Flower2 size={40} className="mx-auto mb-3 opacity-50"/><p>No appointments yet</p></div> :
          appointments.map(a => <div key={a.id} className="bg-white dark:bg-navy-800 rounded-2xl p-4 shadow-sm">
            <div className="flex justify-between items-start mb-2">
              <div className="font-medium text-sm">{a.service_name}</div>
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${a.status === "COMPLETED" ? "bg-emerald-100 text-emerald-700" : a.status === "IN_PROGRESS" ? "bg-sky-100 text-sky-700" : "bg-violet-100 text-violet-700"}`}>{a.status}</span>
            </div>
            <div className="text-xs text-slate-500">{a.appointment_date} at {a.appointment_time} · {a.duration_minutes} min</div>
            {a.therapist_name && <div className="text-xs text-slate-500 mt-1">Therapist: {a.therapist_name}</div>}
            <div className="text-sm font-semibold mt-2">₦{Number(a.price || 0).toLocaleString()}</div>
          </div>)}
      </div>}
    </div>

    {/* Book Modal */}
    {showBook && <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center" onClick={() => setShowBook(null)}>
      <div className="bg-white dark:bg-navy-800 rounded-t-3xl w-full max-w-lg p-6 animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="w-12 h-1 bg-slate-200 dark:bg-slate-600 rounded-full mx-auto mb-4"/>
        <h3 className="font-semibold text-lg mb-1">Book {showBook.name}</h3>
        <p className="text-sm text-slate-500 mb-4">{showBook.duration_minutes} min · ₦{Number(showBook.price).toLocaleString()}</p>
        <div className="space-y-3">
          <div><label className="text-sm text-slate-500 mb-1 block">Date</label><input type="date" className="w-full h-11 px-4 border border-slate-200 dark:border-slate-600 rounded-xl text-sm bg-white dark:bg-navy-900" value={bookForm.date} onChange={e => setBookForm({ ...bookForm, date: e.target.value })}/></div>
          <div><label className="text-sm text-slate-500 mb-1 block">Preferred Time</label><select className="w-full h-11 px-4 border border-slate-200 dark:border-slate-600 rounded-xl text-sm bg-white dark:bg-navy-900" value={bookForm.time} onChange={e => setBookForm({ ...bookForm, time: e.target.value })}>{["09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00"].map(t => <option key={t} value={t}>{t}</option>)}</select></div>
          <div><label className="text-sm text-slate-500 mb-1 block">Special Requests</label><textarea className="w-full h-16 px-4 border border-slate-200 dark:border-slate-600 rounded-xl text-sm bg-white dark:bg-navy-900 resize-none" value={bookForm.notes} onChange={e => setBookForm({ ...bookForm, notes: e.target.value })} placeholder="Any preferences..."/></div>
        </div>
        <div className="flex gap-3 mt-5"><button className="flex-1 h-12 rounded-2xl border border-slate-200 dark:border-slate-600 text-sm font-medium" onClick={() => setShowBook(null)}>Cancel</button>
          <button className="flex-1 h-12 rounded-2xl bg-gradient-to-r from-violet-600 to-purple-600 text-white text-sm font-semibold" onClick={handleBook}>Confirm Booking</button>
        </div>
      </div>
    </div>}
  </div>;
}

// ═══════════════════════════════════════════════════════════════════
// CONCIERGE / HELP SCREEN
// ═══════════════════════════════════════════════════════════════════
function GuestConcierge() {
  const { request } = useGuest();
  const [requests, setRequests] = useState([]); const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ requestType: "ROOM_SERVICE", description: "", priority: "NORMAL" });
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRequests(await request("/guest/concierge")); } catch {} finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function handleSubmit(e) {
    e.preventDefault(); if (!form.description) return;
    try {
      await request("/guest/concierge", { method: "POST", body: JSON.stringify(form) });
      setShowNew(false); setForm({ requestType: "ROOM_SERVICE", description: "", priority: "NORMAL" });
      setToast({ msg: "Request submitted! Our team will assist you shortly.", type: "success" }); load();
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
  }

  const requestTypes = [
    { value: "ROOM_SERVICE", label: "🍽️ Room Service", desc: "Extra towels, pillows, amenities" },
    { value: "CONCIERGE", label: "🚗 Concierge", desc: "Transport, reservations, tours" },
    { value: "MAINTENANCE", label: "🔧 Maintenance", desc: "Report an issue in your room" },
    { value: "HOUSEKEEPING", label: "🧹 Housekeeping", desc: "Extra cleaning, turndown service" },
    { value: "TECHNOLOGY", label: "💻 Technology", desc: "WiFi, TV, connectivity issues" },
    { value: "OTHER", label: "📋 Other", desc: "General requests" },
  ];

  const statusColors = { PENDING: "bg-amber-100 text-amber-700", IN_PROGRESS: "bg-sky-100 text-sky-700", COMPLETED: "bg-emerald-100 text-emerald-700" };

  return <div className="pb-20">
    {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)}/>}
    <div className="bg-gradient-to-br from-sky-900 to-blue-800 text-white p-6 pb-8 rounded-b-3xl">
      <h1 className="text-xl font-bold mb-1">Concierge & Help</h1>
      <p className="text-sm text-sky-200">We're here to make your stay perfect</p>
      <button className="mt-4 px-6 py-2.5 rounded-xl bg-white text-sky-900 text-sm font-semibold" onClick={() => setShowNew(true)}>New Request</button>
    </div>

    <div className="px-4 mt-4">
      <h3 className="font-semibold mb-3">My Requests</h3>
      {loading ? <div className="text-center py-8 text-slate-400 text-sm">Loading…</div> :
        requests.length === 0 ? <div className="text-center py-12 text-slate-400"><MessageSquareText size={40} className="mx-auto mb-3 opacity-50"/><p>No requests yet</p></div> :
          <div className="space-y-3">{requests.map(r => <div key={r.id} className="bg-white dark:bg-navy-800 rounded-2xl p-4 shadow-sm">
            <div className="flex justify-between items-start mb-2">
              <div className="font-medium text-sm">{r.request_type?.replace(/_/g, " ")}</div>
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColors[r.status] || "bg-slate-100 text-slate-700"}`}>{r.status?.replace(/_/g, " ")}</span>
            </div>
            <p className="text-xs text-slate-500">{r.description}</p>
            <div className="text-xs text-slate-400 mt-2">{new Date(r.created_at).toLocaleString()}</div>
          </div>)}</div>
      }
    </div>

    {/* New Request Modal */}
    {showNew && <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center" onClick={() => setShowNew(false)}>
      <div className="bg-white dark:bg-navy-800 rounded-t-3xl w-full max-w-lg p-6 animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="w-12 h-1 bg-slate-200 dark:bg-slate-600 rounded-full mx-auto mb-4"/>
        <h3 className="font-semibold text-lg mb-4">New Request</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">{requestTypes.map(rt => <button key={rt.value} type="button" className={`p-3 rounded-xl border text-left text-sm transition ${form.requestType === rt.value ? "border-brand-400 bg-brand-50 dark:bg-brand-900/20" : "border-slate-200 dark:border-slate-600"}`} onClick={() => setForm({ ...form, requestType: rt.value })}>
            <div className="font-medium">{rt.label}</div><div className="text-xs text-slate-500 mt-0.5">{rt.desc}</div>
          </button>)}</div>
          <div><label className="text-sm text-slate-500 mb-1 block">Description</label><textarea className="w-full h-24 px-4 border border-slate-200 dark:border-slate-600 rounded-xl text-sm bg-white dark:bg-navy-900 resize-none" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Tell us what you need..." required/></div>
          <div><label className="text-sm text-slate-500 mb-1 block">Priority</label><select className="w-full h-11 px-4 border border-slate-200 dark:border-slate-600 rounded-xl text-sm bg-white dark:bg-navy-900" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}><option value="LOW">Low — When convenient</option><option value="NORMAL">Normal</option><option value="HIGH">High — Soon please</option><option value="URGENT">Urgent — ASAP</option></select></div>
          <div className="flex gap-3 pt-2"><button type="button" className="flex-1 h-12 rounded-2xl border border-slate-200 dark:border-slate-600 text-sm font-medium" onClick={() => setShowNew(false)}>Cancel</button>
            <button type="submit" className="flex-1 h-12 rounded-2xl bg-gradient-to-r from-sky-600 to-blue-600 text-white text-sm font-semibold">Submit</button>
          </div>
        </form>
      </div>
    </div>}
  </div>;
}

// ═══════════════════════════════════════════════════════════════════
// PROFILE / FOLIO SCREEN
// ═══════════════════════════════════════════════════════════════════
function GuestProfile() {
  const { guest, reservation, request, logout } = useGuest();
  const [folio, setFolio] = useState(null); const [folioItems, setFolioItems] = useState([]);
  const [feedback, setFeedback] = useState({ rating: 5, comment: "", category: "Overall" });
  const [activeTab, setActiveTab] = useState("info"); const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [notiPrefs, setNotiPrefs] = useState(null);
  const [notiLoading, setNotiLoading] = useState(false);

  useEffect(() => {
    request("/guest/folio").then(d => { setFolio(d.folio); setFolioItems(d.items || []); }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Load notification preferences when tab is selected
  useEffect(() => {
    if (activeTab === "preferences" && !notiPrefs) {
      setNotiLoading(true);
      request("/guest/notification-preferences").then(d => { setNotiPrefs(d); }).catch(() => {}).finally(() => setNotiLoading(false));
    }
  }, [activeTab]);

  async function saveNotiPrefs(patch) {
    try {
      const updated = { ...notiPrefs, ...patch };
      setNotiPrefs(updated);
      await request("/guest/notification-preferences", { method: "PATCH", body: JSON.stringify(patch) });
      setToast({ msg: "Preferences saved!", type: "success" });
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
  }

  async function submitFeedback() {
    try {
      await request("/guest/feedback", { method: "POST", body: JSON.stringify(feedback) });
      setToast({ msg: "Thank you for your feedback!", type: "success" }); setFeedback({ rating: 5, comment: "", category: "Overall" });
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
  }

  return <div className="pb-20">
    {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)}/>}
    <div className="bg-gradient-to-br from-navy-900 to-navy-800 text-white p-6 pb-8 rounded-b-3xl">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-500 grid place-items-center text-navy-950 font-bold text-lg">{guest?.firstName?.[0]}{guest?.lastName?.[0]}</div>
        <div><h2 className="text-lg font-bold">{guest?.firstName} {guest?.lastName}</h2><p className="text-sm text-slate-400">{guest?.email || guest?.phone}</p>
          {guest?.loyaltyTier && <div className="flex items-center gap-1 mt-1"><Star size={12} className="text-brand-400" fill="currentColor"/><span className="text-xs text-brand-300">{guest.loyaltyTier} Member · {guest.loyaltyPoints || 0} pts</span></div>}
        </div>
      </div>
      <div className="flex gap-2">
        {[["info", User, "Info"], ["folio", Receipt, "Folio"], ["feedback", Heart, "Feedback"], ["preferences", Bell, "Alerts"]].map(([key, Icon, label]) =>
          <button key={key} className={`px-4 py-2 rounded-xl text-sm font-medium transition ${activeTab === key ? "bg-brand-400 text-navy-950" : "bg-white/10 text-white/60"}`} onClick={() => setActiveTab(key)}><Icon size={14} className="inline mr-1"/>{label}</button>
        )}
      </div>
    </div>

    <div className="px-4 mt-4">
      {activeTab === "info" && <div className="space-y-3">
        <div className="bg-white dark:bg-navy-800 rounded-2xl p-4 shadow-sm"><h3 className="font-semibold text-sm mb-3">Stay Details</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><div className="text-xs text-slate-500">Confirmation</div><div className="font-mono font-medium">{reservation?.confirmationNumber}</div></div>
            <div><div className="text-xs text-slate-500">Room</div><div className="font-medium">{reservation?.roomNumber} · {reservation?.roomType}</div></div>
            <div><div className="text-xs text-slate-500">Check-in</div><div className="font-medium">{reservation?.checkIn}</div></div>
            <div><div className="text-xs text-slate-500">Check-out</div><div className="font-medium">{reservation?.checkOut}</div></div>
            <div><div className="text-xs text-slate-500">Status</div><div className="font-medium">{reservation?.status?.replace(/_/g, " ")}</div></div>
            <div><div className="text-xs text-slate-500">Guests</div><div className="font-medium">{reservation?.adults} adult(s), {reservation?.children} child(ren)</div></div>
          </div>
        </div>
        {reservation?.amenities && <div className="bg-white dark:bg-navy-800 rounded-2xl p-4 shadow-sm"><h3 className="font-semibold text-sm mb-2">Room Amenities</h3>
          <div className="flex flex-wrap gap-2">{(typeof reservation.amenities === "string" ? JSON.parse(reservation.amenities) : reservation.amenities || []).map((a, i) => <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">{a}</span>)}</div>
        </div>}
        {guest?.allergies && <div className="bg-rose-50 dark:bg-rose-900/10 rounded-2xl p-4 border border-rose-200 dark:border-rose-800"><div className="text-sm font-medium text-rose-700">⚠️ Allergies</div><div className="text-sm text-rose-600 mt-1">{guest.allergies}</div></div>}
        <button className="w-full h-12 rounded-2xl border border-slate-200 dark:border-slate-600 text-sm font-medium text-rose-600 flex items-center justify-center gap-2" onClick={logout}><LogOut size={16}/> Sign Out</button>
      </div>}

      {activeTab === "folio" && <div>
        {folio ? <div>
          <div className="bg-white dark:bg-navy-800 rounded-2xl p-4 shadow-sm mb-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div><div className="text-xs text-slate-500">Charges</div><div className="font-bold">₦{Number(folio.total_charges || 0).toLocaleString()}</div></div>
              <div><div className="text-xs text-slate-500">Payments</div><div className="font-bold text-emerald-600">₦{Number(folio.total_payments || 0).toLocaleString()}</div></div>
              <div><div className="text-xs text-slate-500">Balance</div><div className={`font-bold ${folio.balance > 0 ? "text-rose-600" : "text-emerald-600"}`}>₦{Number(folio.balance || 0).toLocaleString()}</div></div>
            </div>
          </div>
          <h3 className="font-semibold text-sm mb-3">Charges & Payments</h3>
          <div className="space-y-2">{folioItems.map(item => <div key={item.id} className="bg-white dark:bg-navy-800 rounded-xl p-3 shadow-sm flex justify-between items-center">
            <div><div className="text-sm font-medium">{item.description}</div><div className="text-xs text-slate-500">{item.category} · {new Date(item.created_at).toLocaleDateString()}</div></div>
            <div className={`font-semibold text-sm ${item.amount < 0 ? "text-emerald-600" : ""}`}>{item.amount < 0 ? "+" : "-"}₦{Math.abs(Number(item.amount)).toLocaleString()}</div>
          </div>)}
            {!folioItems.length && <div className="text-center py-8 text-slate-400 text-sm">No charges yet</div>}
          </div>
        </div> : <div className="text-center py-12 text-slate-400"><Receipt size={40} className="mx-auto mb-3 opacity-50"/><p>No folio found</p></div>}
      </div>}

      {activeTab === "feedback" && <div className="space-y-4">
        <div className="bg-white dark:bg-navy-800 rounded-2xl p-5 shadow-sm">
          <h3 className="font-semibold mb-3">Rate Your Stay</h3>
          <div className="flex justify-center gap-2 mb-4">{[1,2,3,4,5].map(n => <button key={n} onClick={() => setFeedback({ ...feedback, rating: n })} className="p-1"><Star size={32} className={n <= feedback.rating ? "text-brand-400" : "text-slate-200 dark:text-slate-600"} fill={n <= feedback.rating ? "currentColor" : "none"}/></button>)}</div>
          <div className="mb-3"><label className="text-sm text-slate-500 mb-1 block">Category</label><select className="w-full h-11 px-4 border border-slate-200 dark:border-slate-600 rounded-xl text-sm bg-white dark:bg-navy-900" value={feedback.category} onChange={e => setFeedback({ ...feedback, category: e.target.value })}>{["Overall", "Room", "Service", "Restaurant", "Spa", "Cleanliness", "Check-in/Out"].map(c => <option key={c}>{c}</option>)}</select></div>
          <div><label className="text-sm text-slate-500 mb-1 block">Your Comments</label><textarea className="w-full h-24 px-4 border border-slate-200 dark:border-slate-600 rounded-xl text-sm bg-white dark:bg-navy-900 resize-none" value={feedback.comment} onChange={e => setFeedback({ ...feedback, comment: e.target.value })} placeholder="Tell us about your experience..."/></div>
          <button className="w-full h-12 rounded-2xl bg-gradient-to-r from-brand-400 to-brand-500 text-navy-950 font-semibold text-sm mt-4" onClick={submitFeedback}>Submit Feedback</button>
        </div>
      </div>}

      {activeTab === "preferences" && <div className="space-y-3">
        <div className="bg-white dark:bg-navy-800 rounded-2xl p-4 shadow-sm">
          <h3 className="font-semibold text-sm mb-3">📬 Notification Delivery</h3>
          <p className="text-xs text-slate-500 mb-4">Choose how you'd like to receive updates about your stay. These notifications are sent even without the app.</p>
          {notiLoading ? <div className="text-center py-6 text-slate-400 text-sm">Loading...</div> : notiPrefs && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div><div className="text-sm font-medium">📧 Email Notifications</div><div className="text-xs text-slate-500">{guest?.email || "No email on file"}</div></div>
                <button className={`w-12 h-7 rounded-full transition-colors relative ${notiPrefs.email_enabled ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"}`} onClick={() => saveNotiPrefs({ emailEnabled: !notiPrefs.email_enabled })}>
                  <div className={`w-5 h-5 rounded-full bg-white shadow absolute top-1 transition-transform ${notiPrefs.email_enabled ? "translate-x-6" : "translate-x-1"}`}/>
                </button>
              </div>
              <div className="flex items-center justify-between">
                <div><div className="text-sm font-medium">📱 SMS Notifications</div><div className="text-xs text-slate-500">{guest?.phone || "No phone on file"}</div></div>
                <button className={`w-12 h-7 rounded-full transition-colors relative ${notiPrefs.sms_enabled ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"}`} onClick={() => saveNotiPrefs({ smsEnabled: !notiPrefs.sms_enabled })}>
                  <div className={`w-5 h-5 rounded-full bg-white shadow absolute top-1 transition-transform ${notiPrefs.sms_enabled ? "translate-x-6" : "translate-x-1"}`}/>
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="bg-white dark:bg-navy-800 rounded-2xl p-4 shadow-sm">
          <h3 className="font-semibold text-sm mb-3">🔔 Notification Types</h3>
          <p className="text-xs text-slate-500 mb-4">Select which notifications you'd like to receive.</p>
          {notiPrefs && (
            <div className="space-y-4">
              {[ 
                ["roomServiceUpdates", "🍽️ Room Service Updates", "Order status, delivery confirmations"],
                ["spaUpdates", "💆 Spa Updates", "Appointment confirmations and reminders"],
                ["checkinCheckout", "🏨 Check-in / Check-out", "Welcome messages and checkout receipts"],
                ["promotions", "🎁 Promotions & Offers", "Special deals and loyalty rewards"],
              ].map(([key, label, desc]) => (
                <div key={key} className="flex items-center justify-between">
                  <div><div className="text-sm font-medium">{label}</div><div className="text-xs text-slate-500">{desc}</div></div>
                  <button className={`w-12 h-7 rounded-full transition-colors relative ${notiPrefs[key] ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"}`} onClick={() => saveNotiPrefs({ [key.charAt(0).toUpperCase() + key.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase())]: !notiPrefs[key] })}>
                    <div className={`w-5 h-5 rounded-full bg-white shadow absolute top-1 transition-transform ${notiPrefs[key] ? "translate-x-6" : "translate-x-1"}`}/>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="bg-blue-50 dark:bg-blue-900/10 rounded-2xl p-4 border border-blue-200 dark:border-blue-800">
          <div className="text-sm font-medium text-blue-700">ℹ️ About Notifications</div>
          <div className="text-xs text-blue-600 mt-1 leading-relaxed">
            We'll send important updates about your stay via email and SMS — even without the app. This includes check-in confirmations, room service updates, spa appointments, and checkout receipts. You can disable any notification type above.
          </div>
        </div>
      </div>}
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════
// GUEST MOBILE APP ROOT
// ═══════════════════════════════════════════════════════════════════
export { GuestProvider };

export default function GuestMobileApp() {
  const { guest, loading } = useGuest();
  const [screen, setScreen] = useState("home");
  const [view, setView] = useState("landing"); // landing | login | app

  // Expose navigate for home screen quick actions
  useEffect(() => { window.__guestNavigate = setScreen; return () => { delete window.__guestNavigate; }; }, []);

  if (loading) return <div className="min-h-screen bg-navy-950 flex items-center justify-center flex-col gap-4"><div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-brand-300 to-brand-500 grid place-items-center text-navy-950 animate-pulse"><Crown size={28}/></div><div className="text-brand-300">Loading…</div></div>;

  // If logged in, show the app
  if (guest) {
    const screens = { home: GuestHome, key: GuestDigitalKey, experiences: GuestExperiences, services: GuestRoomService, controls: GuestRoomControls, concierge: GuestConcierge, spa: GuestSpa, profile: GuestProfile };
    const Screen = screens[screen] || GuestHome;
    return <div className={`min-h-screen bg-[#f5f7fb] dark:bg-navy-950 text-slate-800 dark:text-slate-100 max-w-lg mx-auto relative`}>
      <Screen />
      <MobileNav active={screen} onNavigate={setScreen} />
    </div>;
  }

  // Not logged in: show landing or login
  if (view === "login") return <GuestLogin onSwitchToLanding={() => setView("landing")} />;
  return <PublicLandingPage onSwitchToLogin={() => setView("login")} />;
}
