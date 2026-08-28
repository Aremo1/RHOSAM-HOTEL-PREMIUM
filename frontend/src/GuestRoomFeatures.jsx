import React, { useState, useEffect, useCallback } from "react";
import {
  KeyRound, Lock, Unlock, Thermometer, Tv, Lightbulb, Fan, Power,
  Eye, QrCode, Wifi, CheckCircle2, XCircle, ChevronRight, Shield,
  Clock3, AlertTriangle, X, Sun, Moon, Zap, Wind, Minus, Plus
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════
// DIGITAL ROOM KEY SCREEN
// ═══════════════════════════════════════════════════════════════════
export function GuestDigitalKey({ request }) {
  const [key, setKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockResult, setUnlockResult] = useState(null);
  const [showQR, setShowQR] = useState(false);
  const [accessLog, setAccessLog] = useState([]);
  const [showLog, setShowLog] = useState(false);
  const [toast, setToast] = useState(null);
  const [nfcActive, setNfcActive] = useState(false);

  useEffect(() => {
    Promise.all([
      request("/guest/digital-key").catch(() => null),
      request("/guest/digital-key/access-log").catch(() => [])
    ]).then(([k, log]) => { setKey(k); setAccessLog(log); })
      .finally(() => setLoading(false));
  }, []);

  async function activateKey() {
    try {
      const k = await request("/guest/digital-key/activate", { method: "POST" });
      setKey(k);
      setToast({ msg: "Digital key activated!", type: "success" });
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
  }

  async function unlockRoom(method) {
    setUnlocking(true);
    setUnlockResult(null);
    try {
      const result = await request("/guest/digital-key/unlock", {
        method: "POST",
        body: JSON.stringify({ keyCode: method === "QR" ? key?.key_code : undefined })
      });
      setUnlockResult(result);
      if (method === "NFC") {
        setNfcActive(true);
        setTimeout(() => setNfcActive(false), 3000);
      }
      setToast({ msg: result.message, type: "success" });
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
    finally { setUnlocking(false); }
  }

  async function revokeKey() {
    if (!confirm("Revoke your digital key? You'll need to reactivate it.")) return;
    try {
      await request("/guest/digital-key/revoke", { method: "POST" });
      setKey(null);
      setToast({ msg: "Digital key revoked.", type: "success" });
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-10 w-10 rounded-full bg-brand-100 grid place-items-center animate-pulse"><KeyRound size={20} className="text-brand-500"/></div></div>;

  return (
    <div className="pb-20">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)}/>}

      {/* Hero */}
      <div className="bg-gradient-to-br from-navy-900 via-navy-800 to-navy-900 text-white p-6 pb-8 rounded-b-3xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-40 h-40 bg-brand-400/10 rounded-full -translate-y-1/2 translate-x-1/2"/>
        <h1 className="text-xl font-bold mb-1 flex items-center gap-2"><KeyRound size={20}/> Digital Room Key</h1>
        <p className="text-sm text-slate-400">Tap to unlock your room</p>

        {key ? (
          <div className="mt-4 bg-white/10 backdrop-blur rounded-2xl p-4 border border-white/10">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-slate-400">Room</div>
                <div className="text-2xl font-bold">{key.room_number || "—"}</div>
                <div className="text-xs text-slate-400 mt-0.5">{key.room_type || "—"}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-400">Key Status</div>
                <div className="flex items-center gap-1 mt-0.5">
                  <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"/>
                  <span className="text-sm font-semibold text-emerald-400">Active</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
              <div className="bg-white/5 rounded-xl p-2 text-center"><div className="text-slate-400">Type</div><div className="font-semibold mt-0.5">{key.key_type}</div></div>
              <div className="bg-white/5 rounded-xl p-2 text-center"><div className="text-slate-400">Expires</div><div className="font-semibold mt-0.5">{key.expires_at ? new Date(key.expires_at).toLocaleDateString() : "—"}</div></div>
            </div>
          </div>
        ) : (
          <div className="mt-4 bg-white/10 backdrop-blur rounded-2xl p-6 border border-white/10 text-center">
            <Lock size={32} className="text-slate-400 mx-auto mb-3"/>
            <p className="text-sm text-slate-300 mb-4">No active digital key. Activate one to unlock your room.</p>
            <button className="w-full h-12 rounded-2xl bg-gradient-to-r from-brand-400 to-brand-500 text-navy-950 font-semibold text-sm" onClick={activateKey}>
              Activate Digital Key
            </button>
          </div>
        )}
      </div>

      {key && (
        <div className="px-4 mt-4 space-y-4">
          {/* Unlock Actions */}
          <div className="grid grid-cols-2 gap-3">
            {/* NFC Tap to Unlock */}
            <button className={`bg-white dark:bg-navy-800 rounded-2xl p-5 shadow-sm border-2 transition text-center ${nfcActive ? "border-emerald-400 bg-emerald-50" : "border-slate-100 dark:border-slate-700 hover:border-brand-300"} ${unlocking ? "opacity-50" : ""}`}
              onClick={() => unlockRoom("NFC")} disabled={unlocking}>
              <div className={`h-14 w-14 rounded-2xl mx-auto mb-3 grid place-items-center transition ${nfcActive ? "bg-emerald-500 text-white animate-pulse" : "bg-sky-100 dark:bg-sky-900/30 text-sky-600"}`}>
                {nfcActive ? <Unlock size={28}/> : <Wifi size={28}/>}
              </div>
              <div className="font-semibold text-sm">{nfcActive ? "Unlocked!" : "Tap to Unlock"}</div>
              <div className="text-[10px] text-slate-500 mt-1">NFC Simulation</div>
            </button>

            {/* QR Code */}
            <button className={`bg-white dark:bg-navy-800 rounded-2xl p-5 shadow-sm border-2 transition text-center ${showQR ? "border-brand-400 bg-brand-50/50" : "border-slate-100 dark:border-slate-700 hover:border-brand-300"} ${unlocking ? "opacity-50" : ""}`}
              onClick={() => { setShowQR(!showQR); if (!showQR) unlockRoom("QR"); }} disabled={unlocking}>
              <div className="h-14 w-14 rounded-2xl mx-auto mb-3 grid place-items-center bg-violet-100 dark:bg-violet-900/30 text-violet-600">
                <QrCode size={28}/>
              </div>
              <div className="font-semibold text-sm">QR Code</div>
              <div className="text-[10px] text-slate-500 mt-1">Show at door</div>
            </button>
          </div>

          {/* QR Code Display */}
          {showQR && key && (
            <div className="bg-white dark:bg-navy-800 rounded-2xl p-6 shadow-sm border border-slate-100 dark:border-slate-700 text-center">
              <div className="text-sm font-semibold mb-3">Your Room Key QR Code</div>
              <div className="w-48 h-48 mx-auto bg-white rounded-xl border-2 border-slate-200 grid place-items-center p-4 relative">
                {/* Simulated QR Code Pattern */}
                <div className="w-full h-full grid grid-cols-8 grid-rows-8 gap-0.5">
                  {Array.from({ length: 64 }, (_, i) => {
                    const isCorner = (i < 3 || (i > 4 && i < 8)) && (Math.floor(i / 8) < 3) ||
                      (i % 8 < 3 || (i % 8 > 4 && i % 8 < 8)) && Math.floor(i / 8) < 3 ||
                      (i % 8 < 3) && Math.floor(i / 8) > 4;
                    const hash = (key.key_code?.charCodeAt(i % key.key_code.length) || 0) + i;
                    const filled = isCorner || hash % 3 === 0;
                    return <div key={i} className={`rounded-sm ${filled ? "bg-navy-950" : "bg-white"}`}/>;
                  })}
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="bg-white rounded-lg px-2 py-1 shadow-sm"><KeyRound size={16} className="text-brand-500"/></div>
                </div>
              </div>
              <div className="text-xs text-slate-500 mt-3 font-mono">{key.key_code}</div>
              <button className="mt-3 text-xs text-brand-600 font-medium" onClick={() => setShowQR(false)}>Close</button>
            </div>
          )}

          {/* Unlock Result */}
          {unlockResult && (
            <div className="bg-emerald-50 dark:bg-emerald-900/10 rounded-2xl p-4 border border-emerald-200 dark:border-emerald-800 flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-emerald-500 grid place-items-center text-white"><Unlock size={20}/></div>
              <div><div className="font-semibold text-emerald-700">{unlockResult.message}</div><div className="text-xs text-emerald-600">Room {unlockResult.roomNumber}</div></div>
            </div>
          )}

          {/* Key Permissions */}
          {key.permissions && (
            <div className="bg-white dark:bg-navy-800 rounded-2xl p-4 shadow-sm">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Shield size={14}/> Key Permissions</h3>
              <div className="grid grid-cols-4 gap-2">
                {Object.entries(typeof key.permissions === "string" ? JSON.parse(key.permissions) : key.permissions || {}).map(([perm, allowed]) => (
                  <div key={perm} className={`text-center p-2 rounded-xl ${allowed ? "bg-emerald-50 dark:bg-emerald-900/10" : "bg-slate-50 dark:bg-slate-800"}`}>
                    {perm === "lock" ? <Lock size={16} className={`mx-auto ${allowed ? "text-emerald-600" : "text-slate-400"}`}/> :
                     perm === "lights" ? <Lightbulb size={16} className={`mx-auto ${allowed ? "text-emerald-600" : "text-slate-400"}`}/> :
                     perm === "ac" ? <Thermometer size={16} className={`mx-auto ${allowed ? "text-emerald-600" : "text-slate-400"}`}/> :
                     <Tv size={16} className={`mx-auto ${allowed ? "text-emerald-600" : "text-slate-400"}`}/>}
                    <div className={`text-[10px] mt-1 font-medium ${allowed ? "text-emerald-600" : "text-slate-400"}`}>{perm}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Access Log */}
          <button className="w-full bg-white dark:bg-navy-800 rounded-2xl p-4 shadow-sm flex items-center justify-between" onClick={() => setShowLog(!showLog)}>
            <div className="flex items-center gap-3"><Eye size={16} className="text-slate-500"/><span className="text-sm font-medium">Access History</span></div>
            <div className="flex items-center gap-2"><span className="text-xs text-slate-400">{accessLog.length} entries</span><ChevronRight size={14} className={`text-slate-400 transition ${showLog ? "rotate-90" : ""}`}/></div>
          </button>

          {showLog && (
            <div className="space-y-2">
              {accessLog.length === 0 ? <div className="text-center py-6 text-slate-400 text-sm">No access history yet</div> :
                accessLog.map(log => (
                  <div key={log.id} className="bg-white dark:bg-navy-800 rounded-xl p-3 shadow-sm flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`h-8 w-8 rounded-lg grid place-items-center ${log.success ? "bg-emerald-100 text-emerald-600" : "bg-rose-100 text-rose-600"}`}>
                        {log.action === "UNLOCK" ? <Unlock size={14}/> : <KeyRound size={14}/>}
                      </div>
                      <div><div className="text-xs font-medium">{log.action} — Room {log.room_number || "—"}</div><div className="text-[10px] text-slate-500">{log.method} • {new Date(log.created_at).toLocaleString()}</div></div>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${log.success ? "bg-emerald-100 text-emerald-600" : "bg-rose-100 text-rose-600"}`}>{log.success ? "OK" : "FAIL"}</span>
                  </div>
                ))}
            </div>
          )}

          {/* Revoke */}
          <button className="w-full h-11 rounded-2xl border border-rose-200 dark:border-rose-800 text-rose-600 text-sm font-medium" onClick={revokeKey}>Revoke Key</button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ROOM CONTROLS SCREEN
// ═══════════════════════════════════════════════════════════════════
export function GuestRoomControls({ request }) {
  const [controls, setControls] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    request("/guest/room-controls").then(setControls).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function updateControl(patch) {
    const prev = { ...controls };
    setControls({ ...controls, ...patch });
    setSaving(true);
    try {
      const updated = await request("/guest/room-controls", { method: "PATCH", body: JSON.stringify(patch) });
      setControls(updated);
    } catch (e) {
      setControls(prev);
      setToast({ msg: e.message, type: "error" });
    } finally { setSaving(false); }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="h-10 w-10 rounded-full bg-brand-100 grid place-items-center animate-pulse"><Settings size={20} className="text-brand-500"/></div></div>;
  if (!controls) return <div className="text-center py-20 text-slate-400"><Settings size={40} className="mx-auto mb-3 opacity-30"/><p>No room controls available</p></div>;

  return (
    <div className="pb-20">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)}/>}

      {/* Hero */}
      <div className="bg-gradient-to-br from-navy-900 via-navy-800 to-navy-900 text-white p-6 pb-8 rounded-b-3xl">
        <h1 className="text-xl font-bold mb-1 flex items-center gap-2"><Settings size={20}/> Room Controls</h1>
        <p className="text-sm text-slate-400">Control your room environment</p>
        {saving && <div className="mt-2 text-xs text-brand-300 flex items-center gap-1"><div className="h-3 w-3 border border-brand-300/30 border-t-brand-300 rounded-full animate-spin"/> Saving...</div>}
      </div>

      <div className="px-4 mt-4 space-y-4">

        {/* Do Not Disturb */}
        <button className={`w-full p-4 rounded-2xl flex items-center justify-between transition ${controls.do_not_disturb ? "bg-rose-500 text-white" : "bg-white dark:bg-navy-800 shadow-sm"}`} onClick={() => updateControl({ do_not_disturb: !controls.do_not_disturb })}>
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-xl grid place-items-center ${controls.do_not_disturb ? "bg-white/20" : "bg-rose-100 dark:bg-rose-900/30"}`}>
              <Moon size={20} className={controls.do_not_disturb ? "text-white" : "text-rose-600"}/>
            </div>
            <div><div className="font-semibold text-sm">Do Not Disturb</div><div className="text-xs opacity-70">{controls.do_not_disturb ? "Active — Housekeeping will not disturb" : "Tap to activate"}</div></div>
          </div>
          <div className={`h-6 w-11 rounded-full transition ${controls.do_not_disturb ? "bg-white/30" : "bg-slate-200 dark:bg-slate-700"}`}>
            <div className={`h-5 w-5 rounded-full bg-white shadow transition mt-0.5 ${controls.do_not_disturb ? "ml-[22px]" : "ml-0.5"}`}/>
          </div>
        </button>

        {/* LIGHTS */}
        <div className="bg-white dark:bg-navy-800 rounded-2xl p-5 shadow-sm">
          <h3 className="font-semibold text-sm mb-4 flex items-center gap-2"><Lightbulb size={16} className="text-amber-500"/> Lights</h3>
          <div className="space-y-3">
            {[
              { key: "lights_main", label: "Main Lights", icon: Sun, color: "text-amber-500" },
              { key: "lights_bedroom", label: "Bedroom", icon: Moon, color: "text-violet-500" },
              { key: "lights_bathroom", label: "Bathroom", icon: Lightbulb, color: "text-sky-500" },
              { key: "lights_mood", label: "Mood Lighting", icon: Zap, color: "text-pink-500" },
            ].map(({ key, label, icon: Icon, color }) => (
              <div key={key} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Icon size={16} className={color}/>
                  <span className="text-sm">{label}</span>
                </div>
                <button className={`relative h-6 w-11 rounded-full transition ${controls[key] ? "bg-amber-500" : "bg-slate-200 dark:bg-slate-700"}`} onClick={() => updateControl({ [key]: !controls[key] })}>
                  <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${controls[key] ? "left-[22px]" : "left-0.5"}`}/>
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* AIR CONDITIONING */}
        <div className="bg-white dark:bg-navy-800 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-sm flex items-center gap-2"><Thermometer size={16} className="text-sky-500"/> Air Conditioning</h3>
            <button className={`relative h-6 w-11 rounded-full transition ${controls.ac_enabled ? "bg-sky-500" : "bg-slate-200 dark:bg-slate-700"}`} onClick={() => updateControl({ ac_enabled: !controls.ac_enabled })}>
              <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${controls.ac_enabled ? "left-[22px]" : "left-0.5"}`}/>
            </button>
          </div>

          {controls.ac_enabled && (
            <div className="space-y-4">
              {/* Temperature */}
              <div className="text-center">
                <div className="text-5xl font-bold text-sky-600">{controls.ac_temperature}°</div>
                <div className="text-xs text-slate-500 mt-1">Temperature</div>
                <div className="flex items-center justify-center gap-4 mt-3">
                  <button className="h-12 w-12 rounded-full bg-slate-100 dark:bg-slate-700 grid place-items-center hover:bg-slate-200 dark:hover:bg-slate-600 transition" onClick={() => updateControl({ ac_temperature: Math.max(16, controls.ac_temperature - 1) })}>
                    <Minus size={20}/>
                  </button>
                  <button className="h-12 w-12 rounded-full bg-sky-100 dark:bg-sky-900/30 grid place-items-center hover:bg-sky-200 dark:hover:bg-sky-800/50 transition" onClick={() => updateControl({ ac_temperature: Math.min(30, controls.ac_temperature + 1) })}>
                    <Plus size={20}/>
                  </button>
                </div>
              </div>

              {/* Mode */}
              <div>
                <div className="text-xs text-slate-500 mb-2">Mode</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {["COOL", "HEAT", "FAN", "AUTO"].map(mode => (
                    <button key={mode} className={`py-2 rounded-xl text-xs font-medium transition ${controls.ac_mode === mode ? "bg-sky-500 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-600"}`} onClick={() => updateControl({ ac_mode: mode })}>
                      {mode === "COOL" ? <><Wind size={12} className="mx-auto mb-0.5"/>Cool</> :
                       mode === "HEAT" ? <><Zap size={12} className="mx-auto mb-0.5"/>Heat</> :
                       mode === "FAN" ? <><Fan size={12} className="mx-auto mb-0.5"/>Fan</> :
                       <><Settings size={12} className="mx-auto mb-0.5"/>Auto</>}
                    </button>
                  ))}
                </div>
              </div>

              {/* Fan Speed */}
              <div>
                <div className="text-xs text-slate-500 mb-2">Fan Speed: {controls.ac_fan_speed}</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {["LOW", "MED", "HIGH", "AUTO"].map(speed => (
                    <button key={speed} className={`py-2 rounded-xl text-xs font-medium transition ${controls.ac_fan_speed === speed ? "bg-sky-500 text-white" : "bg-slate-100 dark:bg-slate-700 text-slate-600"}`} onClick={() => updateControl({ ac_fan_speed: speed })}>
                      {speed}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* TV */}
        <div className="bg-white dark:bg-navy-800 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-sm flex items-center gap-2"><Tv size={16} className="text-violet-500"/> Television</h3>
            <button className={`relative h-6 w-11 rounded-full transition ${controls.tv_on ? "bg-violet-500" : "bg-slate-200 dark:bg-slate-700"}`} onClick={() => updateControl({ tv_on: !controls.tv_on })}>
              <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${controls.tv_on ? "left-[22px]" : "left-0.5"}`}/>
            </button>
          </div>

          {controls.tv_on && (
            <div className="space-y-4">
              {/* TV Screen Sim */}
              <div className="bg-navy-950 rounded-xl p-4 text-center">
                <div className="text-violet-400 text-xs mb-1">Channel</div>
                <div className="text-3xl font-bold text-white">{controls.tv_channel}</div>
                <div className="h-1 bg-slate-700 rounded-full mt-3">
                  <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${(controls.tv_volume / 100) * 100}%` }}/>
                </div>
                <div className="text-[10px] text-slate-500 mt-1">Vol: {controls.tv_volume}%</div>
              </div>

              {/* Channel */}
              <div>
                <div className="text-xs text-slate-500 mb-2">Channel</div>
                <div className="flex items-center justify-between">
                  <button className="h-10 w-10 rounded-xl bg-slate-100 dark:bg-slate-700 grid place-items-center" onClick={() => updateControl({ tv_channel: Math.max(1, controls.tv_channel - 1) })}><Minus size={16}/></button>
                  <span className="text-lg font-bold">{controls.tv_channel}</span>
                  <button className="h-10 w-10 rounded-xl bg-slate-100 dark:bg-slate-700 grid place-items-center" onClick={() => updateControl({ tv_channel: controls.tv_channel + 1 })}><Plus size={16}/></button>
                </div>
              </div>

              {/* Volume */}
              <div>
                <div className="text-xs text-slate-500 mb-2">Volume</div>
                <input type="range" min="0" max="100" value={controls.tv_volume} onChange={e => updateControl({ tv_volume: Number(e.target.value) })} className="w-full h-2 rounded-full appearance-none bg-slate-200 dark:bg-slate-700 accent-violet-500"/>
              </div>
            </div>
          )}
        </div>

        {/* Curtains */}
        <div className="bg-white dark:bg-navy-800 rounded-2xl p-4 shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 grid place-items-center"><Sun size={20} className="text-amber-600"/></div>
            <div><div className="text-sm font-semibold">Curtains</div><div className="text-xs text-slate-500">{controls.curtains_open ? "Open" : "Closed"}</div></div>
          </div>
          <button className={`relative h-6 w-11 rounded-full transition ${controls.curtains_open ? "bg-amber-500" : "bg-slate-200 dark:bg-slate-700"}`} onClick={() => updateControl({ curtains_open: !controls.curtains_open })}>
            <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${controls.curtains_open ? "left-[22px]" : "left-0.5"}`}/>
          </button>
        </div>

      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// LOCAL EXPERIENCES & ATTRACTIONS
// ═══════════════════════════════════════════════════════════════════
const CATEGORY_ICONS = {
  "Nature & Wildlife": "🦁", "Culture & Arts": "🎨", "Sightseeing": "🏙️",
  "Water Activities": "⛵", "Luxury & Leisure": "💎", "Food & Drink": "🍽️",
  "Exclusive Experiences": "👑", "Adventure": "🏔️",
};

export function GuestExperiences({ request }) {
  const [experiences, setExperiences] = useState([]);
  const [categories, setCategories] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("explore");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [showDetail, setShowDetail] = useState(null);
  const [showBooking, setShowBooking] = useState(null);
  const [bookForm, setBookForm] = useState({ date: "", time: "10:00", groupSize: 1, phone: "", requests: "" });
  const [toast, setToast] = useState(null);

  useEffect(() => {
    Promise.all([
      request("/guest/experiences"),
      request("/guest/experience-categories"),
      request("/guest/experience-bookings").catch(() => [])
    ]).then(([exp, cat, bk]) => { setExperiences(exp); setCategories(cat); setBookings(bk); })
      .finally(() => setLoading(false));
  }, []);

  const filtered = selectedCategory ? experiences.filter(e => e.category === selectedCategory) : experiences;
  const featured = experiences.filter(e => e.is_featured);

  async function handleBook() {
    if (!bookForm.date) { setToast({ msg: "Please select a date", type: "error" }); return; }
    try {
      const result = await request("/guest/experience-book", {
        method: "POST",
        body: JSON.stringify({
          experienceId: showBooking.id,
          bookingDate: bookForm.date,
          bookingTime: bookForm.time,
          groupSize: bookForm.groupSize,
          contactPhone: bookForm.phone,
          specialRequests: bookForm.requests
        })
      });
      setShowBooking(null);
      setBookForm({ date: "", time: "10:00", groupSize: 1, phone: "", requests: "" });
      setToast({ msg: result.message, type: "success" });
      const bk = await request("/guest/experience-bookings");
      setBookings(bk);
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
  }

  async function cancelBooking(id) {
    if (!confirm("Cancel this booking?")) return;
    try {
      await request(`/guest/experience-bookings/${id}`, { method: "DELETE" });
      setToast({ msg: "Booking cancelled", type: "success" });
      const bk = await request("/guest/experience-bookings");
      setBookings(bk);
    } catch (e) { setToast({ msg: e.message, type: "error" }); }
  }

  return (
    <div className="pb-20">
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)}/>}

      {/* Hero */}
      <div className="bg-gradient-to-br from-amber-600 via-orange-500 to-rose-500 text-white p-6 pb-8 rounded-b-3xl">
        <h1 className="text-xl font-bold mb-1">Discover Lagos</h1>
        <p className="text-sm text-amber-100">Curated experiences & attractions near the hotel</p>
        <div className="flex gap-2 mt-4">
          {[["explore", "Explore"], ["bookings", `My Bookings (${bookings.length})`]].map(([key, label]) => (
            <button key={key} className={`px-4 py-2 rounded-xl text-sm font-medium transition ${activeTab === key ? "bg-white text-orange-700" : "bg-white/10 text-white/70"}`} onClick={() => setActiveTab(key)}>{label}</button>
          ))}
        </div>
      </div>

      <div className="px-4 mt-4">
        {activeTab === "explore" && (
          <>
            {/* Categories */}
            <div className="flex gap-2 overflow-x-auto pb-3 -mx-4 px-4 mb-4">
              <button className={`shrink-0 px-3 py-2 rounded-xl text-xs font-medium transition ${!selectedCategory ? "bg-orange-500 text-white" : "bg-white dark:bg-navy-800 text-slate-600 border border-slate-100 dark:border-slate-700"}`} onClick={() => setSelectedCategory("")}>All</button>
              {categories.map(c => (
                <button key={c.category} className={`shrink-0 px-3 py-2 rounded-xl text-xs font-medium transition flex items-center gap-1 ${selectedCategory === c.category ? "bg-orange-500 text-white" : "bg-white dark:bg-navy-800 text-slate-600 border border-slate-100 dark:border-slate-700"}`} onClick={() => setSelectedCategory(c.category)}>
                  {CATEGORY_ICONS[c.category] || "📍"} {c.category} ({c.count})
                </button>
              ))}
            </div>

            {/* Featured */}
            {!selectedCategory && featured.length > 0 && (
              <div className="mb-6">
                <h3 className="font-semibold text-sm mb-3">⭐ Featured</h3>
                <div className="space-y-3">
                  {featured.map(exp => (
                    <div key={exp.id} className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/10 dark:to-orange-900/10 rounded-2xl p-4 border border-amber-200 dark:border-amber-800 cursor-pointer hover:shadow-md transition" onClick={() => setShowDetail(exp)}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="text-xs text-orange-600 font-semibold">{CATEGORY_ICONS[exp.category] || "📍"} {exp.category}</div>
                          <div className="text-sm font-bold mt-1">{exp.name}</div>
                          <div className="text-xs text-slate-500 mt-1 line-clamp-2">{exp.short_description || exp.description}</div>
                          <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-500">
                            <span>⭐ {exp.rating}</span>
                            <span>•</span>
                            <span>{exp.distance_km > 0 ? `${exp.distance_km}km` : "Hotel"}</span>
                            <span>•</span>
                            <span>{exp.duration_hours}h</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0 ml-3">
                          <div className="text-xs text-slate-500">From</div>
                          <div className="text-sm font-bold text-orange-600">{exp.price_from > 0 ? `₦${Number(exp.price_from).toLocaleString()}` : "Free"}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* All Experiences */}
            <div className="space-y-3">
              {loading ? <div className="text-center py-8 text-slate-400 text-sm">Loading experiences...</div> :
                filtered.length === 0 ? <div className="text-center py-8 text-slate-400">No experiences found</div> :
                filtered.map(exp => (
                  <div key={exp.id} className="bg-white dark:bg-navy-800 rounded-2xl p-4 shadow-sm border border-slate-100 dark:border-slate-700 cursor-pointer hover:shadow-md transition" onClick={() => setShowDetail(exp)}>
                    <div className="flex items-start gap-3">
                      <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-orange-100 to-amber-200 dark:from-orange-900/20 dark:to-amber-900/20 grid place-items-center text-2xl shrink-0">
                        {CATEGORY_ICONS[exp.category] || "📍"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-orange-600 font-semibold">{exp.category}</div>
                        <div className="text-sm font-bold truncate">{exp.name}</div>
                        <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">{exp.description}</div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">⭐ {exp.rating}</span>
                          <span className="text-[10px] text-slate-400">{exp.review_count} reviews</span>
                          <span className="text-[10px] text-slate-400">•</span>
                          <span className="text-[10px] text-slate-400">{exp.distance_km > 0 ? `${exp.distance_km}km` : "At hotel"}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[10px] text-slate-500">From</div>
                        <div className="text-sm font-bold text-orange-600">{exp.price_from > 0 ? `₦${Number(exp.price_from).toLocaleString()}` : "Free"}</div>
                        <div className="text-[10px] text-slate-400">per person</div>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </>
        )}

        {activeTab === "bookings" && (
          <div className="space-y-3">
            {bookings.length === 0 ? <div className="text-center py-12 text-slate-400"><Calendar size={40} className="mx-auto mb-3 opacity-30"/><p>No bookings yet</p></div> :
              bookings.map(b => {
                const statusColor = { PENDING: "bg-amber-100 text-amber-700", CONFIRMED: "bg-emerald-100 text-emerald-700", COMPLETED: "bg-sky-100 text-sky-700", CANCELLED: "bg-slate-100 text-slate-500" };
                return (
                  <div key={b.id} className="bg-white dark:bg-navy-800 rounded-2xl p-4 shadow-sm border border-slate-100 dark:border-slate-700">
                    <div className="flex items-start justify-between mb-2">
                      <div><div className="text-sm font-bold">{b.experience_name}</div><div className="text-xs text-slate-500">{b.experience_category} • {b.location}</div></div>
                      <span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${statusColor[b.status] || "bg-slate-100"}`}>{b.status}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                      <div className="bg-slate-50 dark:bg-navy-900 rounded-lg p-2 text-center"><div className="text-slate-500">Date</div><div className="font-semibold">{b.booking_date?.slice(5)}</div></div>
                      <div className="bg-slate-50 dark:bg-navy-900 rounded-lg p-2 text-center"><div className="text-slate-500">Guests</div><div className="font-semibold">{b.group_size}</div></div>
                      <div className="bg-slate-50 dark:bg-navy-900 rounded-lg p-2 text-center"><div className="text-slate-500">Total</div><div className="font-semibold">₦{Number(b.total_price || 0).toLocaleString()}</div></div>
                    </div>
                    {b.status === "PENDING" && <button className="w-full h-9 rounded-xl border border-rose-200 text-rose-600 text-xs font-medium" onClick={() => cancelBooking(b.id)}>Cancel Booking</button>}
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {showDetail && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center" onClick={() => setShowDetail(null)}>
          <div className="bg-white dark:bg-navy-800 rounded-t-3xl w-full max-w-lg max-h-[85vh] overflow-y-auto animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <div className="w-12 h-1 bg-slate-200 dark:bg-slate-600 rounded-full mx-auto mb-4"/>
              <div className="text-center mb-4">
                <div className="text-4xl mb-2">{CATEGORY_ICONS[showDetail.category] || "📍"}</div>
                <div className="text-xs text-orange-600 font-semibold">{showDetail.category}</div>
                <h3 className="text-lg font-bold mt-1">{showDetail.name}</h3>
                <div className="flex items-center justify-center gap-3 text-xs text-slate-500 mt-1">
                  <span>⭐ {showDetail.rating} ({showDetail.review_count} reviews)</span>
                  <span>•</span>
                  <span>{showDetail.distance_km > 0 ? `${showDetail.distance_km}km away` : "At hotel"}</span>
                  <span>•</span>
                  <span>{showDetail.duration_hours}h</span>
                </div>
              </div>

              <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">{showDetail.description}</p>

              {/* Highlights */}
              {showDetail.highlights?.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-xs font-semibold text-slate-500 mb-2">Highlights</h4>
                  <div className="flex flex-wrap gap-1.5">{showDetail.highlights.map((h, i) => <span key={i} className="text-[10px] px-2 py-1 rounded-full bg-orange-50 dark:bg-orange-900/10 text-orange-700">{h}</span>)}</div>
                </div>
              )}

              {/* Includes */}
              {showDetail.includes?.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-xs font-semibold text-slate-500 mb-2">Includes</h4>
                  <div className="space-y-1.5">{showDetail.includes.map((inc, i) => <div key={i} className="flex items-center gap-2 text-xs"><CheckCircle2 size={12} className="text-emerald-500"/> {inc}</div>)}</div>
                </div>
              )}

              {/* Location */}
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-navy-900 mb-4"><div className="text-[10px] text-slate-500 mb-0.5">Location</div><div className="text-sm">{showDetail.location}</div></div>

              <div className="flex items-end justify-between">
                <div><div className="text-xs text-slate-500">From</div><div className="text-2xl font-bold text-orange-600">{showDetail.price_from > 0 ? `₦${Number(showDetail.price_from).toLocaleString()}` : "Free"}</div><div className="text-[10px] text-slate-400">per person</div></div>
                <button className="h-12 px-6 rounded-2xl bg-gradient-to-r from-orange-500 to-rose-500 text-white font-semibold text-sm shadow-lg shadow-orange-500/20" onClick={() => { setShowDetail(null); setShowBooking(showDetail); }}>Book Now</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Booking Modal */}
      {showBooking && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center" onClick={() => setShowBooking(null)}>
          <div className="bg-white dark:bg-navy-800 rounded-t-3xl w-full max-w-lg p-6 animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="w-12 h-1 bg-slate-200 dark:bg-slate-600 rounded-full mx-auto mb-4"/>
            <h3 className="font-semibold text-lg mb-1">Book {showBooking.name}</h3>
            <p className="text-sm text-slate-500 mb-4">{showBooking.category} • ₦{Number(showBooking.price_from).toLocaleString()} per person</p>

            <div className="space-y-3">
              <div><label className="text-sm text-slate-500 mb-1 block">Date</label><input type="date" className="w-full h-11 px-4 border border-slate-200 dark:border-slate-600 rounded-xl text-sm bg-white dark:bg-navy-900" value={bookForm.date} onChange={e => setBookForm({ ...bookForm, date: e.target.value })}/></div>
              <div><label className="text-sm text-slate-500 mb-1 block">Preferred Time</label><select className="w-full h-11 px-4 border border-slate-200 dark:border-slate-600 rounded-xl text-sm bg-white dark:bg-navy-900" value={bookForm.time} onChange={e => setBookForm({ ...bookForm, time: e.target.value })}>{["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00"].map(t => <option key={t} value={t}>{t}</option>)}</select></div>
              <div><label className="text-sm text-slate-500 mb-1 block">Group Size</label><div className="flex items-center gap-3"><button className="h-10 w-10 rounded-xl bg-slate-100 dark:bg-slate-700 grid place-items-center" onClick={() => setBookForm({ ...bookForm, groupSize: Math.max(1, bookForm.groupSize - 1) })}><Minus size={16}/></button><span className="text-lg font-bold w-8 text-center">{bookForm.groupSize}</span><button className="h-10 w-10 rounded-xl bg-slate-100 dark:bg-slate-700 grid place-items-center" onClick={() => setBookForm({ ...bookForm, groupSize: Math.min(showBooking.max_group_size, bookForm.groupSize + 1) })}><Plus size={16}/></button><span className="text-xs text-slate-500">Max {showBooking.max_group_size}</span></div></div>
              <div><label className="text-sm text-slate-500 mb-1 block">Contact Phone</label><input className="w-full h-11 px-4 border border-slate-200 dark:border-slate-600 rounded-xl text-sm bg-white dark:bg-navy-900" placeholder="+234..." value={bookForm.phone} onChange={e => setBookForm({ ...bookForm, phone: e.target.value })}/></div>
              <div><label className="text-sm text-slate-500 mb-1 block">Special Requests</label><textarea className="w-full h-16 px-4 border border-slate-200 dark:border-slate-600 rounded-xl text-sm bg-white dark:bg-navy-900 resize-none" value={bookForm.requests} onChange={e => setBookForm({ ...bookForm, requests: e.target.value })} placeholder="Any preferences..."/></div>
            </div>

            {/* Price Summary */}
            <div className="bg-slate-50 dark:bg-navy-900 rounded-xl p-3 mt-4">
              <div className="flex justify-between text-sm"><span>{bookForm.groupSize} × ₦{Number(showBooking.price_from).toLocaleString()}</span><span className="font-bold">₦{Number(showBooking.price_from * bookForm.groupSize).toLocaleString()}</span></div>
              <div className="text-[10px] text-slate-500 mt-1">Concierge will confirm availability</div>
            </div>

            <div className="flex gap-3 mt-4"><button className="flex-1 h-12 rounded-2xl border border-slate-200 dark:border-slate-600 text-sm font-medium" onClick={() => setShowBooking(null)}>Cancel</button><button className="flex-1 h-12 rounded-2xl bg-gradient-to-r from-orange-500 to-rose-500 text-white text-sm font-semibold" onClick={handleBook}>Confirm Booking</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SHARED TOAST
// ═══════════════════════════════════════════════════════════════════
function Toast({ message, type = "success", onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, []);
  const bg = type === "error" ? "bg-rose-500" : type === "info" ? "bg-sky-500" : "bg-emerald-500";
  return <div className={`fixed top-4 left-4 right-4 ${bg} text-white px-4 py-3 rounded-2xl shadow-xl z-50 text-sm font-medium flex items-center gap-2 animate-slide-down`}>
    {type === "error" ? <XCircle size={18}/> : <CheckCircle2 size={18}/>}{message}
  </div>;
}
