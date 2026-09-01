import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { retryFetch } from "./retryFetch";

const CurrencyContext = createContext(null);
export function useCurrency() { return useContext(CurrencyContext); }

const DEFAULT_CURRENCIES = {
  NGN: { name: "Nigerian Naira", symbol: "₦", code: "NGN", rate: 1 },
  USD: { name: "US Dollar", symbol: "$", code: "USD", rate: 0.00065 },
  GBP: { name: "British Pound", symbol: "£", code: "GBP", rate: 0.00052 },
  EUR: { name: "Euro", symbol: "€", code: "EUR", rate: 0.00060 },
  AED: { name: "UAE Dirham", symbol: "د.إ", code: "AED", rate: 0.0024 },
  ZAR: { name: "South African Rand", symbol: "R", code: "ZAR", rate: 0.012 },
  GHS: { name: "Ghanaian Cedi", symbol: "₵", code: "GHS", rate: 0.010 },
  KES: { name: "Kenyan Shilling", symbol: "KSh", code: "KES", rate: 0.084 },
  CNY: { name: "Chinese Yuan", symbol: "¥", code: "CNY", rate: 0.0047 },
  INR: { name: "Indian Rupee", symbol: "₹", code: "INR", rate: 0.054 },
};

export function CurrencyProvider({ children }) {
  const [baseCurrency, setBaseCurrency] = useState(() => localStorage.getItem("rhosam_currency") || "NGN");
  const [currencies, setCurrencies] = useState(DEFAULT_CURRENCIES);
  const [enabledCurrencies, setEnabledCurrencies] = useState(["NGN", "USD", "GBP", "EUR", "AED"]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("rhosam_token");
    if (!token) { setLoading(false); return; }
    retryFetch("/api/currencies", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          if (d.currencies) setCurrencies(d.currencies);
          if (d.config?.baseCurrency) { setBaseCurrency(d.config.baseCurrency); localStorage.setItem("rhosam_currency", d.config.baseCurrency); }
          if (d.config?.enabled) setEnabledCurrencies(d.config.enabled);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const changeBaseCurrency = useCallback((code) => {
    setBaseCurrency(code);
    localStorage.setItem("rhosam_currency", code);
  }, []);

  // Convert from base currency to target currency
  const convert = useCallback((baseAmount, toCurrency) => {
    if (!baseAmount || toCurrency === baseCurrency) return Number(baseAmount);
    const fromRate = currencies[baseCurrency]?.rate || 1;
    const toRate = currencies[toCurrency]?.rate || 1;
    return Math.round((Number(baseAmount) / fromRate * toRate) * 100) / 100;
  }, [baseCurrency, currencies]);

  // Format amount in a specific currency
  const format = useCallback((amount, currencyCode = baseCurrency) => {
    const curr = currencies[currencyCode] || currencies.NGN;
    const val = Number(amount) || 0;
    if (currencyCode === "NGN") return `${curr.symbol}${val.toLocaleString()}`;
    return `${curr.symbol}${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }, [baseCurrency, currencies]);

  // Format with currency code label
  const formatWithCode = useCallback((amount, currencyCode = baseCurrency) => {
    const curr = currencies[currencyCode] || currencies.NGN;
    const val = Number(amount) || 0;
    return `${curr.symbol}${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currencyCode}`;
  }, [baseCurrency, currencies]);

  // Get the symbol for a currency
  const getSymbol = useCallback((code) => {
    return currencies[code]?.symbol || code;
  }, [currencies]);

  // Convert and format
  const convertAndFormat = useCallback((baseAmount, toCurrency) => {
    const converted = convert(baseAmount, toCurrency);
    return format(converted, toCurrency);
  }, [convert, format]);

  const value = {
    baseCurrency, currencies, enabledCurrencies, loading,
    changeBaseCurrency, convert, format, formatWithCode, getSymbol, convertAndFormat,
    getCurrencyInfo: (code) => currencies[code],
  };

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}
