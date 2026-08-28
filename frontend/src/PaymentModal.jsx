import React, { useState, useEffect } from "react";
import {
  CreditCard, X, CheckCircle2, AlertTriangle, Globe, Banknote,
  Smartphone, Building2, Clock3, ArrowRight, Shield, Zap
} from "lucide-react";
import { useCurrency } from "./CurrencyContext";

const GATEWAY_ICONS = {
  stripe: { icon: CreditCard, color: "bg-violet-100 text-violet-700", label: "Stripe" },
  paystack: { icon: Zap, color: "bg-emerald-100 text-emerald-700", label: "Paystack" },
  flutterwave: { icon: Globe, color: "bg-sky-100 text-sky-700", label: "Flutterwave" },
  manual: { icon: Banknote, color: "bg-amber-100 text-amber-700", label: "Cash / Manual" },
};

const GATEWAYS = [
  { id: "stripe", name: "Stripe", description: "Accept cards worldwide (Visa, Mastercard, Amex)", currencies: ["USD", "EUR", "GBP", "NGN"], fee: "2.9% + ₦100" },
  { id: "paystack", name: "Paystack", description: "African payments leader — cards, bank, USSD", currencies: ["NGN", "USD", "GHS", "ZAR", "KES"], fee: "1.5% (capped at ₦2,000)" },
  { id: "flutterwave", name: "Flutterwave", description: "Pan-African & global — cards, mobile money, bank", currencies: ["NGN", "USD", "GBP", "EUR", "GHS", "KES", "ZAR"], fee: "1.4%" },
  { id: "manual", name: "Cash / Manual", description: "Record cash, bank transfer, or terminal payments", currencies: ["NGN", "USD", "GBP", "EUR", "AED", "ZAR", "GHS", "KES", "CNY", "INR"], fee: "No processing fee" },
];

export default function PaymentModal({ open, onClose, onPaymentComplete, folioId, reservationId, guestName, defaultAmount, defaultCurrency }) {
  const { currencies, baseCurrency, enabledCurrencies, convert, format, formatWithCode, getSymbol } = useCurrency();
  const [step, setStep] = useState("form"); // form | processing | success | failed
  const [gateway, setGateway] = useState("paystack");
  const [amount, setAmount] = useState(defaultAmount || "");
  const [currency, setCurrency] = useState(defaultCurrency || baseCurrency);
  const [email, setEmail] = useState("");
  const [description, setDescription] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setStep("form"); setAmount(defaultAmount || ""); setCurrency(defaultCurrency || baseCurrency);
      setEmail(""); setDescription(""); setResult(null); setError("");
    }
  }, [open]);

  if (!open) return null;

  const gw = GATEWAYS.find(g => g.id === gateway);
  const supportedCurrencies = gw?.currencies || [];
  const isCurrencySupported = supportedCurrencies.includes(currency);
  const convertedAmount = convert(Number(amount) || 0, currency);
  const feeEstimate = gateway === "manual" ? 0 : gateway === "paystack" ? Math.min(Number(amount) * 0.015, 2000) : gateway === "stripe" ? Number(amount) * 0.029 + 100 : Number(amount) * 0.014;

  async function handlePayment() {
    if (!amount || Number(amount) <= 0) { setError("Please enter a valid amount."); return; }
    setStep("processing"); setError("");
    try {
      const token = localStorage.getItem("rhosam_token");
      const r = await fetch("/api/payments/process", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ folioId, reservationId, amount: Number(amount), currency, gateway, guestEmail: email, guestName, description: description || `Payment via ${gw.name}` })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message);
      setResult(d.transaction);
      setStep("success");
      if (onPaymentComplete) onPaymentComplete(d.transaction);
    } catch (e) {
      setError(e.message);
      setStep("failed");
    }
  }

  return <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
    <div className="bg-white dark:bg-navy-800 rounded-3xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
      {/* Header */}
      <div className="p-6 pb-4 border-b border-slate-100 dark:border-slate-700/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-brand-100 dark:bg-brand-900/30 grid place-items-center"><CreditCard size={20} className="text-brand-600"/></div>
            <div><h2 className="font-semibold text-lg">Process Payment</h2>{guestName && <p className="text-sm text-slate-500">{guestName}</p>}</div>
          </div>
          <button className="h-8 w-8 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center" onClick={onClose}><X size={18}/></button>
        </div>
      </div>

      {step === "form" && <div className="p-6 space-y-5">
        {/* Currency Selection */}
        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">Currency</label>
          <div className="grid grid-cols-5 gap-1.5">
            {enabledCurrencies.map(code => {
              const c = currencies[code];
              return <button key={code} className={`p-2 rounded-xl text-center border-2 transition text-xs font-medium ${currency === code ? "border-brand-400 bg-brand-50 dark:bg-brand-900/20 text-brand-700" : "border-slate-100 dark:border-slate-700 hover:border-slate-200 dark:hover:border-slate-600"}`} onClick={() => setCurrency(code)}>
                <div className="text-base">{c?.symbol}</div><div className="mt-0.5">{code}</div>
              </button>;
            })}
          </div>
        </div>

        {/* Amount */}
        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Amount ({currencies[currency]?.symbol})</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-slate-400">{currencies[currency]?.symbol}</span>
            <input type="number" className="input pl-10 h-14 text-2xl font-bold" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" min="0" step="0.01"/>
          </div>
          {amount && currency !== baseCurrency && <div className="text-xs text-slate-500 mt-1.5">≈ {formatWithCode(convertedAmount, baseCurrency)} in base currency</div>}
        </div>

        {/* Gateway Selection */}
        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">Payment Method</label>
          <div className="space-y-2">
            {GATEWAYS.map(g => {
              const Icon = GATEWAY_ICONS[g.id]?.icon || CreditCard;
              const isSupported = g.currencies.includes(currency);
              return <button key={g.id} disabled={!isSupported} className={`w-full p-3 rounded-xl border-2 text-left flex items-center gap-3 transition ${gateway === g.id ? "border-brand-400 bg-brand-50/50 dark:bg-brand-900/10" : "border-slate-100 dark:border-slate-700 hover:border-slate-200"} ${!isSupported ? "opacity-40 cursor-not-allowed" : ""}`} onClick={() => isSupported && setGateway(g.id)}>
                <div className={`h-10 w-10 rounded-xl grid place-items-center ${GATEWAY_ICONS[g.id]?.color}`}><Icon size={20}/></div>
                <div className="flex-1"><div className="text-sm font-semibold">{g.name}</div><div className="text-xs text-slate-500">{g.description}</div></div>
                <div className="text-right"><div className="text-[10px] text-slate-400">Fee: {g.fee}</div>{!isSupported && <div className="text-[10px] text-rose-500">Not available</div>}</div>
              </button>;
            })}
          </div>
        </div>

        {/* Email for receipts */}
        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Receipt Email (optional)</label>
          <input type="email" className="input" value={email} onChange={e => setEmail(e.target.value)} placeholder="guest@example.com"/>
        </div>

        {/* Description */}
        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Description (optional)</label>
          <input className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Room charge, restaurant bill, etc."/>
        </div>

        {/* Summary */}
        {amount > 0 && <div className="bg-slate-50 dark:bg-navy-900 rounded-2xl p-4 space-y-2">
          <div className="flex justify-between text-sm"><span className="text-slate-500">Amount</span><span className="font-semibold">{formatWithCode(Number(amount), currency)}</span></div>
          {gateway !== "manual" && <div className="flex justify-between text-sm"><span className="text-slate-500">Est. Fee ({gw?.name})</span><span className="text-slate-600">{format(Math.round(feeEstimate), currency)}</span></div>}
          <div className="border-t border-slate-200 dark:border-slate-700 pt-2 flex justify-between"><span className="font-medium">Total</span><span className="font-bold text-lg">{formatWithCode(Number(amount), currency)}</span></div>
        </div>}

        {/* Actions */}
        <div className="flex gap-3">
          <button className="flex-1 h-12 rounded-2xl border border-slate-200 dark:border-slate-600 text-sm font-medium" onClick={onClose}>Cancel</button>
          <button className="flex-1 h-12 rounded-2xl bg-gradient-to-r from-brand-400 to-brand-500 text-navy-950 font-semibold text-sm shadow-lg shadow-brand-400/20 flex items-center justify-center gap-2" onClick={handlePayment} disabled={!amount || Number(amount) <= 0}>
            <Shield size={16}/> Pay {amount ? formatWithCode(Number(amount), currency) : ""}
          </button>
        </div>
      </div>}

      {step === "processing" && <div className="p-12 text-center">
        <div className="h-16 w-16 rounded-full bg-brand-100 dark:bg-brand-900/30 grid place-items-center mx-auto mb-4 animate-pulse"><CreditCard size={32} className="text-brand-500"/></div>
        <h3 className="text-lg font-semibold mb-2">Processing Payment…</h3>
        <p className="text-sm text-slate-500">Connecting to {gw?.name} securely</p>
        <div className="mt-4 flex justify-center gap-1">{[0,1,2].map(i => <div key={i} className="h-2 w-2 rounded-full bg-brand-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }}/>)}</div>
      </div>}

      {step === "success" && <div className="p-8 text-center">
        <div className="h-16 w-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 grid place-items-center mx-auto mb-4"><CheckCircle2 size={32} className="text-emerald-500"/></div>
        <h3 className="text-lg font-semibold mb-2">Payment Successful!</h3>
        {result && <div className="bg-slate-50 dark:bg-navy-900 rounded-2xl p-4 mt-4 text-left space-y-2">
          <div className="flex justify-between text-sm"><span className="text-slate-500">Transaction ID</span><span className="font-mono font-semibold text-xs">{result.id}</span></div>
          <div className="flex justify-between text-sm"><span className="text-slate-500">Amount</span><span className="font-semibold">{result.symbol}{Number(result.amount).toLocaleString()} {result.currency}</span></div>
          <div className="flex justify-between text-sm"><span className="text-slate-500">Gateway</span><span className="font-medium">{result.gateway}</span></div>
          <div className="flex justify-between text-sm"><span className="text-slate-500">Status</span><span className="text-emerald-600 font-semibold">{result.status}</span></div>
        </div>}
        <button className="w-full h-12 rounded-2xl bg-navy-900 dark:bg-brand-400 text-white dark:text-navy-950 font-semibold text-sm mt-6" onClick={onClose}>Done</button>
      </div>}

      {step === "failed" && <div className="p-8 text-center">
        <div className="h-16 w-16 rounded-full bg-rose-100 dark:bg-rose-900/30 grid place-items-center mx-auto mb-4"><AlertTriangle size={32} className="text-rose-500"/></div>
        <h3 className="text-lg font-semibold mb-2">Payment Failed</h3>
        <p className="text-sm text-slate-500 mb-4">{error}</p>
        <div className="flex gap-3">
          <button className="flex-1 h-12 rounded-2xl border border-slate-200 dark:border-slate-600 text-sm font-medium" onClick={onClose}>Cancel</button>
          <button className="flex-1 h-12 rounded-2xl bg-navy-900 dark:bg-brand-400 text-white dark:text-navy-950 font-semibold text-sm" onClick={() => setStep("form")}>Try Again</button>
        </div>
      </div>}
    </div>
  </div>;
}
