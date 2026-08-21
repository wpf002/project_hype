import { useState, useEffect, useRef } from "react";
import HOW_TO_BUY from "./howToBuy";
import {
  FlagIcon, Zap, BarChart2, Flame, Target, Info, Briefcase,
  Bell, AlertTriangle, Newspaper, Link2, Search, TrendingUp,
  Eye, Check, CheckCircle2, X, AlertCircle, Circle,
} from "./icons";

// In docker-compose / nginx proxy: VITE_API_URL="" (or unset) → relative /api/* URLs
// In Railway production: VITE_API_URL=https://backend-production-6057.up.railway.app
const API = import.meta.env.VITE_API_URL || "";

function trackEvent(name, props) {
  if (typeof window.plausible !== "undefined") {
    window.plausible(name, { props });
  }
}

const HYPE_COLORS = {
  high: "#ff4d4d",
  mid: "#ffa500",
  low: "#00d4aa",
};

// Primary commodity driver label per currency (mirrors backend COMMODITY_LINKS).
// Used in the Catalyst panel to contextualise the commodity signal.
const COMMODITY_DRIVER = {
  IQD: "Oil", NGN: "Oil", VES: "Oil", AZN: "Oil", KZT: "Oil/Gold",
  YER: "Oil", SDG: "Oil", IRR: "Oil", SYP: "Oil", MZN: "LNG",
  PKR: "Oil ↑bad", TRY: "Oil ↑bad", EGP: "Oil ↑bad",
  IDR: "Oil ↑bad", MMK: "Oil ↑bad", LAK: "Oil ↑bad", BDT: "Oil ↑bad",
  GHS: "Gold/Cocoa", ZWG: "Gold", MNT: "Copper/Gold",
  ETB: "Gold", TZS: "Gold", UZS: "Gold", SLL: "Gold",
  CDF: "Copper", ARS: "Soy", XOF: "Cocoa",
};

function HypeBar({ score, title }) {
  const color = score >= 80 ? HYPE_COLORS.high : score >= 55 ? HYPE_COLORS.mid : HYPE_COLORS.low;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}
      title={title || `Hype Score ${score}/100 — measures current news volume, recency, and rate volatility`}>
      <div style={{ flex: 1, height: 6, background: "#1a1a2e", borderRadius: 3, overflow: "hidden" }}>
        <div style={{
          width: `${score}%`, height: "100%", background: color,
          borderRadius: 3, transition: "width 0.6s ease",
          boxShadow: `0 0 8px ${color}`
        }} />
      </div>
      <span style={{ color, fontWeight: 700, fontSize: 13, minWidth: 28, fontFamily: "monospace" }}>{score}</span>
    </div>
  );
}

function catalystColor(score) {
  if (score >= 70) return "#00b4ff";
  if (score >= 40) return "#7a6acd";
  return "#9b59b6";
}

function CatalystBar({ score, title }) {
  const color = catalystColor(score);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}
      title={title || `Catalyst Score ${score}/100 — forward-looking: news sentiment (60%) + 7-day rate momentum (40%)`}>
      <div style={{ flex: 1, height: 6, background: "#1a1a2e", borderRadius: 3, overflow: "hidden" }}>
        <div style={{
          width: `${score}%`, height: "100%",
          background: `linear-gradient(90deg, #9b59b6, ${color})`,
          borderRadius: 3, transition: "width 0.6s ease",
          boxShadow: `0 0 8px ${color}`
        }} />
      </div>
      <span style={{ color, fontWeight: 700, fontSize: 13, minWidth: 28, fontFamily: "monospace" }}>{score}</span>
    </div>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <div style={{
      background: "linear-gradient(135deg, #0d0d1a 0%, #111128 100%)",
      border: "1px solid #1e1e3f", borderRadius: 12, padding: "18px 20px", flex: 1,
    }}>
      <div style={{ color: "#8080aa", fontSize: 11, textTransform: "uppercase", letterSpacing: 2, marginBottom: 6 }}>{label}</div>
      <div style={{ color: "#e8e8ff", fontSize: 22, fontWeight: 700, fontFamily: "'Space Mono', monospace" }}>{value}</div>
      {sub && <div style={{ color: "#8080aa", fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function LiveDot({ secondsSince }) {
  const label = secondsSince == null
    ? null
    : secondsSince < 60
    ? `${secondsSince}s ago`
    : `${Math.floor(secondsSince / 60)}m ago`;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
      <span style={{
        display: "inline-block", width: 8, height: 8, borderRadius: "50%",
        background: "#00d4aa", boxShadow: "0 0 8px #00d4aa", animation: "pulse 2s infinite", flexShrink: 0,
      }} />
      <span style={{ color: "#00d4aa", fontSize: 12, letterSpacing: 1, flexShrink: 0 }}>LIVE</span>
      {label && (
        <span style={{ color: "#5c5c8a", fontSize: 10, fontFamily: "'Space Mono', monospace", flexShrink: 0 }}>
          · {label}
        </span>
      )}
    </span>
  );
}

// Small % change indicator — green positive, red negative, grey no data
function ChangeChip({ value }) {
  if (value === null || value === undefined) {
    return <span style={{ fontSize: 10, color: "#8080aa", fontFamily: "'Space Mono', monospace" }}>—</span>;
  }
  const pos = value >= 0;
  const color = pos ? "#00d4aa" : "#ff4d4d";
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, fontFamily: "'Space Mono', monospace",
      color, padding: "2px 5px", borderRadius: 4,
      background: pos ? "#00d4aa11" : "#ff4d4d11",
      border: `1px solid ${pos ? "#00d4aa33" : "#ff4d4d33"}`,
      whiteSpace: "nowrap",
    }}>
      {pos ? "+" : ""}{value.toFixed(2)}%
    </span>
  );
}

// 4-state rate badge — shows exactly where the rate came from
function RateBadge({ live, source }) {
  const src = source || (live ? "exchangerate-api" : "analyst");
  const cfg = {
    oxr:               { label: "OXR",     bg: "#001a3a", color: "#4da6ff", border: "#4da6ff33", tooltip: "Source: Open Exchange Rates (live)" },
    "exchangerate-api":{ label: "LIVE",    bg: "#003322", color: "#00d4aa", border: "#00d4aa33", tooltip: "Source: ExchangeRate-API (live)" },
    scraped:           { label: "SCRAPED", bg: "#2a1500", color: "#ffa500", border: "#ffa50033", tooltip: "Source: Scraped from parallel-market tracker" },
    analyst:           { label: "EST",     bg: "#1a1a00", color: "#8080aa", border: "#8080aa33", tooltip: "Source: Analyst estimate — official rate may not reflect parallel market" },
  }[src] || { label: "EST", bg: "#1a1a00", color: "#8080aa", border: "#8080aa33", tooltip: "Analyst estimate" };

  return (
    <span
      title={cfg.tooltip}
      style={{
        fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, letterSpacing: 1,
        background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
        marginLeft: 8, verticalAlign: "middle", cursor: "help",
      }}
    >
      {cfg.label}
    </span>
  );
}


// Sanctions badge — comprehensive (illegal for US persons) vs targeted (entity-level OFAC)
function SanctionsBadge({ sanctions }) {
  if (!sanctions) return null;
  const cfg = sanctions === "comprehensive"
    ? { label: "SANCTIONED", bg: "#2a0000", color: "#ff4d4d", border: "#ff4d4d44", tooltip: "Comprehensive US sanctions (OFAC) — transacting in this currency is illegal for US persons" }
    : { label: "OFAC",       bg: "#1a0e00", color: "#ff9933", border: "#ff993344", tooltip: "Targeted OFAC sanctions — specific entities/sectors are designated; consult compliance before trading" };
  return (
    <span
      title={cfg.tooltip}
      style={{
        fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, letterSpacing: 1,
        background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
        marginLeft: 6, verticalAlign: "middle", cursor: "help",
      }}
    >
      {cfg.label}
    </span>
  );
}


function Sparkline({ data, color = "#00d4aa", height = 48 }) {
  // W/H are the fixed internal coordinate space — always numeric.
  // The `height` prop only sets the CSS height so it can be "100%" or a number.
  const W = 300, H = 100;

  if (!data || data.length < 2) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 11, color: "#5c5c8a" }}>Collecting data…</span>
      </div>
    );
  }
  // data is newest-first from the API; reverse for left→right chronological order
  const pts = [...data].reverse().map(s => s.rate);
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const range = max - min || max * 0.001; // avoid division by zero on flat line
  const points = pts
    .map((v, i) => `${(i / (pts.length - 1)) * W},${H - ((v - min) / range) * H}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block", overflow: "visible" }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Glow duplicate */}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.15"
      />
    </svg>
  );
}

/**
 * HeaderTicker — rotates through the top 3 catalyst currencies every 3 seconds.
 *
 * Extracted from ProjectHype so that the 3-second setInterval only re-renders
 * this small component rather than the entire 2,600-line parent.
 *
 * Props: currencies — the live currency list (used to derive tickerPool)
 */
function CurrencySelect({ currencies, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pos, setPos] = useState({});
  const triggerRef = useRef(null);
  const listRef = useRef(null);

  const filtered = search
    ? currencies.filter(c =>
        c.code.toLowerCase().includes(search.toLowerCase()) ||
        c.name.toLowerCase().includes(search.toLowerCase())
      )
    : currencies;

  function openMenu() {
    const rect = triggerRef.current.getBoundingClientRect();
    const LIST_H = 280;
    const spaceBelow = window.innerHeight - rect.bottom - 4;
    const spaceAbove = rect.top - 4;
    const openUp = spaceBelow < LIST_H && spaceAbove > spaceBelow;
    setPos({
      left: rect.left,
      width: rect.width,
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
    });
    setSearch("");
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (
        !triggerRef.current?.contains(e.target) &&
        !listRef.current?.contains(e.target)
      ) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        onClick={() => open ? setOpen(false) : openMenu()}
        style={{
          width: "100%", padding: "10px 16px", boxSizing: "border-box",
          background: "#070714", border: "1px solid #1e1e3f", borderRadius: 8,
          color: "#e8e8ff", fontSize: 13, fontWeight: 600, cursor: "pointer",
          textAlign: "left", display: "flex", alignItems: "center",
          justifyContent: "space-between", gap: 8,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
          {selected ? <><FlagIcon code={selected.code} size={14} />{selected.code} — {selected.name}</> : "Select…"}
        </span>
        <span style={{ color: "#8080aa", fontSize: 10, flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▼</span>
      </button>
      {open && (
        <div
          ref={listRef}
          style={{
            position: "fixed", zIndex: 9999,
            top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width,
            maxHeight: 280, overflowY: "auto",
            background: "#0d0d1a", border: "1px solid #1e1e3f", borderRadius: 8,
            boxShadow: "0 8px 32px #00000099",
          }}
        >
          <div style={{ padding: "8px 8px 4px", position: "sticky", top: 0, background: "#0d0d1a", borderBottom: "1px solid #1a1a2e" }}>
            <input
              autoFocus
              placeholder="Search currencies…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: "100%", padding: "7px 10px", boxSizing: "border-box",
                background: "#070714", border: "1px solid #1e1e3f",
                borderRadius: 6, color: "#e8e8ff", fontSize: 12, outline: "none",
              }}
            />
          </div>
          {filtered.map(c => (
            <div
              key={c.code}
              onClick={() => { onChange(c); setOpen(false); }}
              style={{
                padding: "9px 14px", cursor: "pointer", fontSize: 13,
                color: c.code === selected?.code ? "#00d4aa" : "#e8e8ff",
                background: c.code === selected?.code ? "#0d1a1a" : "transparent",
                fontWeight: c.code === selected?.code ? 700 : 400,
              }}
              onMouseEnter={e => { if (c.code !== selected?.code) e.currentTarget.style.background = "#111128"; }}
              onMouseLeave={e => { if (c.code !== selected?.code) e.currentTarget.style.background = "transparent"; }}
            >
              <FlagIcon code={c.code} size={14} style={{ marginRight: 4 }} />{c.code} — {c.name}
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: "12px 14px", color: "#8080aa", fontSize: 12 }}>No match</div>
          )}
        </div>
      )}
    </div>
  );
}

function HeaderTicker({ currencies }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 3000);
    return () => clearInterval(id);
  }, []);

  const topCatalyst = [...currencies]
    .filter(c => c.catalyst_score != null)
    .sort((a, b) => b.catalyst_score - a.catalyst_score)
    .slice(0, 3);
  const pool = topCatalyst.length >= 3 ? topCatalyst : currencies;
  if (!pool.length) return null;
  const cur = pool[tick % pool.length];

  return (
    <div style={{
      display: "flex", alignItems: "stretch",
      background: "#080818", border: "1px solid #1e3a5f",
      borderRadius: 6, overflow: "hidden",
      fontFamily: "'Space Mono', monospace",
      animation: "tick 3s ease infinite",
    }}>
      <div style={{ padding: "6px 14px", background: "#00b4ff12", borderRight: "1px solid #1e3a5f", display: "flex", alignItems: "center" }}>
        <span style={{ color: "#00b4ff", fontWeight: 700, fontSize: 13, letterSpacing: 1 }}>{cur.code}</span>
      </div>
      <div style={{ padding: "6px 14px", borderRight: "1px solid #1e3a5f", display: "flex", alignItems: "center" }}>
        {(() => {
          const hs = cur.hype_score ?? cur.hype;
          if (hs == null) return <span style={{ color: "#8080aa", fontSize: 12 }}>—</span>;
          const hc = hs >= 80 ? "#ff4d4d" : hs >= 55 ? "#ffa500" : "#00d4aa";
          return <span style={{ color: hc, fontWeight: 700, fontSize: 13 }}>{Math.round(hs)}</span>;
        })()}
      </div>
      <div style={{ padding: "6px 14px", display: "flex", alignItems: "center" }}>
        {(() => {
          const cat = cur.catalyst_score;
          if (cat == null) return <span style={{ color: "#8080aa", fontSize: 12 }}>—</span>;
          const cc = catalystColor(cat);
          return <span style={{ color: cc, fontWeight: 700, fontSize: 13 }}>{Math.round(cat)}</span>;
        })()}
      </div>
    </div>
  );
}


export default function ProjectHype() {
  const [currencies, setCurrencies] = useState([]);
  const [loadingRates, setLoadingRates] = useState(true);
  const [selected, setSelected] = useState(null);
  const [amount, setAmount] = useState("20000000");
  const [targetRate, setTargetRate] = useState("");
  const [usdBuy, setUsdBuy] = useState("");
  const [unitsBuy, setUnitsBuy] = useState("");
  const [results, setResults] = useState(null);
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window === "undefined") return "calculator";
    const tabFromHash = window.location.hash.replace("#", "");
    const valid = ["calculator", "markets", "heatmap", "signals", "portfolio", "about"];
    return valid.includes(tabFromHash) ? tabFromHash : "calculator";
  });
  const [headlines, setHeadlines] = useState([]);
  const [loadingNews, setLoadingNews] = useState(false);
  const [rateHistory, setRateHistory] = useState([]);
  const [signalSearch, setSignalSearch] = useState("");
  const [institutionalSignals, setInstitutionalSignals] = useState([]);
  const [loadingSignals, setLoadingSignals] = useState(false);
  const [marketSearch, setMarketSearch] = useState("");
  const [marketSort, setMarketSort] = useState("hype"); // "hype" | "catalyst"
  const [bottomView, setBottomView] = useState("hype"); // "hype" | "catalyst"
  const [historyWindow, setHistoryWindow] = useState("6H");
  const [openAccordion, setOpenAccordion] = useState(null);

  // ── Portfolio ─────────────────────────────────────────────────────────────
  const [portfolio, setPortfolio] = useState(() => {
    try { return JSON.parse(localStorage.getItem("hype_portfolio") || "[]"); }
    catch { return []; }
  });
  const [pfCode, setPfCode] = useState("");
  const [pfAmount, setPfAmount] = useState("");

  // ── Buy modal ─────────────────────────────────────────────────────────────
  const [buyModal, setBuyModal] = useState(null); // currency object or null

  // ── Share modal ───────────────────────────────────────────────────────────
  const [shareModal, setShareModal] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [shareCopied, setShareCopied] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);

  // ── Disclaimer modal (shown once per browser, dismissed to localStorage) ──
  const [disclaimerOpen, setDisclaimerOpen] = useState(() => {
    try { return !localStorage.getItem("hype_disclaimer_v1"); }
    catch { return true; }
  });
  function dismissDisclaimer() {
    try { localStorage.setItem("hype_disclaimer_v1", "1"); } catch {}
    trackEvent("disclaimer_accepted", {});
    setDisclaimerOpen(false);
  }

  // ── Alert modal ───────────────────────────────────────────────────────────
  const [alertModal, setAlertModal] = useState(false);
  const [alertEmail, setAlertEmail] = useState("");
  const [alertCodes, setAlertCodes] = useState(new Set());
  const [alertSubmitted, setAlertSubmitted] = useState(false);
  const [alertLoading, setAlertLoading] = useState(false);
  const [alertError, setAlertError] = useState("");

  // ── Error / loading states ────────────────────────────────────────────────
  const [ratesError, setRatesError] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState(null);
  const [secondsSince, setSecondsSince] = useState(0);

  // ── Shared-view banner (loaded from ?portfolio= URL param) ────────────────
  const [isSharedView, setIsSharedView] = useState(false);


  // ── Responsive breakpoints ────────────────────────────────────────────────
  const [windowWidth, setWindowWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1200
  );
  useEffect(() => {
    const handler = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  const isMobile = windowWidth < 768;
  const isNarrow = windowWidth < 900;

  // ── Persist portfolio to localStorage on every change ────────────────────
  useEffect(() => {
    localStorage.setItem("hype_portfolio", JSON.stringify(portfolio));
  }, [portfolio]);

  function addPosition() {
    const code = pfCode || (currencies[0]?.code ?? "");
    const amt = parseFloat(pfAmount);
    if (!code || isNaN(amt) || amt <= 0) return;
    setPortfolio(prev => {
      const existing = prev.findIndex(p => p.code === code);
      if (existing >= 0) {
        // Merge into existing position
        const updated = [...prev];
        updated[existing] = { ...updated[existing], amount: updated[existing].amount + amt };
        return updated;
      }
      return [...prev, { code, amount: amt, addedAt: Date.now() }];
    });
    trackEvent("portfolio_add", { code });
    setPfAmount("");
  }

  function removePosition(code) {
    setPortfolio(prev => prev.filter(p => p.code !== code));
  }

  // ── Fetch all 40 currencies with live rates on mount ──────────────────────
  const fetchRates = (showLoading = false, attempt = 0) => {
    setRatesError(false);
    if (showLoading) setLoadingRates(true);
    fetch(`${API}/api/rates`)
      .then(r => { if (!r.ok) throw new Error("API error"); return r.json(); })
      .then(data => {
        setCurrencies(data);
        setSelected(prev => prev ? (data.find(c => c.code === prev.code) ?? data[0]) : data[0]);
        setLoadingRates(false);
        setLastFetchedAt(Date.now());
        setSecondsSince(0);
      })
      .catch(() => {
        // Retry up to 4 times with backoff before showing the error screen —
        // covers the brief window during a backend restart where fetches fail.
        if (attempt < 4) {
          setTimeout(() => fetchRates(showLoading, attempt + 1), 1500 * (attempt + 1));
        } else {
          setLoadingRates(false);
          setRatesError(true);
        }
      });
  };
  useEffect(() => {
    fetchRates(true); // initial load — show loading screen
    const refreshId = setInterval(() => fetchRates(false), 60_000); // background refresh — silent
    return () => clearInterval(refreshId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Tick secondsSince every second so the "Updated X ago" label stays current
  useEffect(() => {
    if (!lastFetchedAt) return;
    setSecondsSince(0);
    const id = setInterval(() => setSecondsSince(Math.floor((Date.now() - lastFetchedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [lastFetchedAt]);

  // ── Load shared portfolio from ?portfolio= URL param ──────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shareId = params.get("portfolio");
    if (!shareId) return;
    fetch(`${API}/api/portfolio/${shareId}`)
      .then(r => { if (!r.ok) throw new Error("not found"); return r.json(); })
      .then(positions => {
        setPortfolio(positions.map(p => ({ ...p, addedAt: Date.now() })));
        setIsSharedView(true);
        setActiveTab("portfolio");
      })
      .catch(() => {}); // silently ignore invalid IDs
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function sharePortfolio() {
    if (portfolio.length === 0) return;
    setShareLoading(true);
    try {
      const res = await fetch(`${API}/api/portfolio/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positions: portfolio.map(p => ({ code: p.code, amount: p.amount })) }),
      });
      const data = await res.json();
      setShareUrl(data.url);
      setShareModal(true);
      setShareCopied(false);
      trackEvent("portfolio_share", {});
    } catch {
      // ignore
    } finally {
      setShareLoading(false);
    }
  }

  // Ticker animation is now in HeaderTicker (separate component) so its
  // 3-second setInterval doesn't re-render the entire ProjectHype tree.

  // ── Recalculate ROI whenever selection or inputs change ───────────────────
  useEffect(() => {
    if (!selected) return;
    calculate();
  }, [selected, amount, targetRate]);

  // ── Reset converter when currency changes (rate changed, old values stale) ─
  useEffect(() => {
    setUsdBuy("");
    setUnitsBuy("");
  }, [selected?.code]);

  function handleUsdBuyChange(val) {
    setUsdBuy(val);
    const usd = parseFloat(val);
    const rate = selected?.rate;
    if (usd > 0 && rate > 0) {
      const units = usd / rate;
      setUnitsBuy(units >= 1 ? String(Math.round(units)) : units.toFixed(6));
      trackEvent("converter_used", { code: selected?.code, direction: "usd_to_currency" });
    } else {
      setUnitsBuy("");
    }
  }

  function handleUnitsBuyChange(val) {
    setUnitsBuy(val);
    const units = parseFloat(val);
    const rate = selected?.rate;
    if (units > 0 && rate > 0) {
      const usd = units * rate;
      setUsdBuy(usd >= 0.01 ? usd.toFixed(2) : usd.toFixed(6));
      trackEvent("converter_used", { code: selected?.code, direction: "currency_to_usd" });
    } else {
      setUsdBuy("");
    }
  }

  // ── Fetch news whenever the selected currency changes ─────────────────────
  useEffect(() => {
    if (!selected) return;
    setHeadlines([]);
    setLoadingNews(true);
    fetch(`${API}/api/news/${selected.code}`)
      .then(r => { if (!r.ok) throw new Error(`news ${r.status}`); return r.json(); })
      .then(data => { setHeadlines(Array.isArray(data) ? data : []); setLoadingNews(false); })
      .catch(() => setLoadingNews(false));
  }, [selected]);

  // ── Fetch rate history whenever selected currency or time window changes ────
  const HISTORY_LIMITS = { "1H": 12, "6H": 72, "24H": 288, "7D": 672 };
  useEffect(() => {
    if (!selected) return;
    setRateHistory([]);
    const limit = HISTORY_LIMITS[historyWindow] ?? 72;
    fetch(`${API}/api/history/${selected.code}?limit=${limit}`)
      .then(r => { if (!r.ok) throw new Error(`history ${r.status}`); return r.json(); })
      .then(data => setRateHistory(Array.isArray(data) ? data : []))
      .catch(() => setRateHistory([]));
  }, [selected, historyWindow]);

  // ── Fetch institutional signals whenever the selected currency changes ─────
  useEffect(() => {
    if (!selected) return;
    setInstitutionalSignals([]);
    setLoadingSignals(true);
    fetch(`${API}/api/signals/${selected.code}`)
      .then(r => { if (!r.ok) throw new Error(`signals ${r.status}`); return r.json(); })
      .then(data => { setInstitutionalSignals(Array.isArray(data) ? data : []); setLoadingSignals(false); })
      .catch(() => setLoadingSignals(false));
  }, [selected]);

  function calculate() {
    const amt = parseFloat(amount);
    if (isNaN(amt) || !isFinite(amt) || amt <= 0) { setResults(null); return; }

    // Guard against a stale or unavailable rate — rate should be a positive
    // finite number; an exotic currency with no feed may have rate = 0.
    const rate = selected?.rate;
    if (!rate || !isFinite(rate) || rate <= 0) { setResults(null); return; }

    const currentVal = amt * rate;

    if (!targetRate || parseFloat(targetRate) <= 0) {
      setResults({ currentVal, targetVal: null, gain: null, roi: null, multiplier: null });
      return;
    }

    const tgt = parseFloat(targetRate);
    if (!isFinite(tgt) || tgt <= 0) { setResults(null); return; }

    const targetVal = amt * tgt;
    const gain = targetVal - currentVal;
    const roi = ((gain / currentVal) * 100).toFixed(2);
    const multiplier = tgt / rate;

    setResults({ currentVal, targetVal, gain, roi: String(roi), multiplier });
    trackEvent("roi_calculated", { code: selected.code, has_target: true });
  }

  const fmt = (n) => {
    if (n === null || n === undefined) return "—";
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
    return `$${n.toFixed(4)}`;
  };

  // Full dollar format — no abbreviation, always shows exact amount with commas.
  // Used for Target Value and ROI gain where precision matters.
  const fmtFull = (n) => {
    if (n === null || n === undefined) return "—";
    return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };


  const topHype = [...currencies].sort((a, b) => (b.hype_score ?? b.hype) - (a.hype_score ?? a.hype)).slice(0, 6);
  const topCatalyst = [...currencies].filter(c => c.catalyst_score != null).sort((a, b) => b.catalyst_score - a.catalyst_score);

  // ── Error screen ──────────────────────────────────────────────────────────
  if (ratesError) {
    return (
      <div style={{
        minHeight: "100vh", background: "#070714", display: "flex",
        alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 20,
      }}>
        <style>{`@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(1.3)}}`}</style>
        <AlertTriangle size={40} color="#ffa500" />
        <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 800, color: "#e8e8ff" }}>
          Unable to reach the Project Hype API
        </div>
        <div style={{ fontSize: 13, color: "#8080aa", maxWidth: 380, textAlign: "center", lineHeight: 1.6 }}>
          The backend is temporarily unavailable. Check your connection or try again.
        </div>
        <button
          onClick={fetchRates}
          style={{
            padding: "12px 32px", borderRadius: 10, border: "1px solid #1e1e3f", cursor: "pointer",
            background: "linear-gradient(135deg, #1e1e4f, #252560)",
            color: "#e8e8ff", fontSize: 14, fontWeight: 700, letterSpacing: 1,
          }}
        >
          ↻ Retry
        </button>
      </div>
    );
  }

  // ── Loading screen ────────────────────────────────────────────────────────
  if (loadingRates || !selected) {
    return (
      <div style={{ minHeight: "100vh", background: "#070714" }}>
        <style>{`
          @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(1.3)}}
          @keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}
        `}</style>
        {/* Header skeleton */}
        <div style={{ height: 64, background: "#0d0d2e", borderBottom: "1px solid #1e1e3f",
          display: "flex", alignItems: "center", padding: isMobile ? "0 16px" : "0 40px", gap: 16 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10,
            background: "linear-gradient(135deg,#ff4d4d,#ff8c00)",
            display: "flex", alignItems: "center", justifyContent: "center", animation: "pulse 1.5s infinite" }}><Zap size={18} color="#fff" fill="#fff" /></div>
          <div>
            <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: 2 }}>
              PROJECT <span style={{ color: "#ff4d4d" }}>HYPE</span>
            </div>
          </div>
        </div>
        {/* Content skeleton */}
        <div style={{ maxWidth: 1400, margin: "0 auto", padding: isMobile ? "16px" : "32px 40px" }}>
          <div style={{ display: isNarrow ? "block" : "grid", gridTemplateColumns: "1fr 380px", gap: 24 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Tab bar skeleton */}
              <div style={{ height: 44, borderRadius: 10, background: "linear-gradient(90deg,#0d0d1a 0%,#1a1a2e 50%,#0d0d1a 100%)",
                backgroundSize: "800px 100%", animation: "shimmer 1.5s infinite linear" }} />
              {/* Currency selector skeleton */}
              <div style={{ borderRadius: 16, border: "1px solid #1e1e3f", padding: 28, background: "#0d0d1a", display: "flex", flexDirection: "column", gap: 16 }}>
                {[80, 180, 60].map((w, i) => (
                  <div key={i} style={{ height: i === 1 ? 52 : 36, width: `${w}%`, maxWidth: "100%", borderRadius: 8,
                    background: "linear-gradient(90deg,#0d0d1a 0%,#1a1a2e 50%,#0d0d1a 100%)",
                    backgroundSize: "800px 100%", animation: `shimmer 1.5s ${i * 0.15}s infinite linear` }} />
                ))}
              </div>
            </div>
            {/* Sidebar skeleton */}
            <div style={{ height: 400, borderRadius: 16, border: "1px solid #1e1e3f",
              background: "linear-gradient(90deg,#0d0d1a 0%,#1a1a2e 50%,#0d0d1a 100%)",
              backgroundSize: "800px 100%", animation: "shimmer 1.5s 0.2s infinite linear" }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh", background: "#070714",
      color: "#e8e8ff", fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif", padding: 0,
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&family=Syne:wght@700;800&display=swap');
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.6;transform:scale(1.3)} }
        @keyframes slideIn { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes glow { 0%,100%{box-shadow:0 0 20px #00d4aa22} 50%{box-shadow:0 0 40px #00d4aa44} }
        @keyframes tick { 0%{opacity:0;transform:translateX(-8px)} 20%{opacity:1;transform:translateX(0)} 80%{opacity:1} 100%{opacity:0;transform:translateX(8px)} }
        @keyframes shimmer { 0%{background-position:-800px 0} 100%{background-position:800px 0} }
        @keyframes gradpulse { 0%,100%{opacity:.4} 50%{opacity:.8} }
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:#0d0d1a} ::-webkit-scrollbar-thumb{background:#1e1e3f;border-radius:2px}
        input:focus{outline:none!important} select:focus{outline:none!important}
        .tab-bar::-webkit-scrollbar{display:none}
      `}</style>

      {/* Persistent disclaimer banner */}
      <div style={{
        background: "#110a00", borderBottom: "1px solid #3a2200",
        padding: "9px 20px", textAlign: isMobile ? "left" : "center", fontSize: 12,
        color: "#b08040", letterSpacing: 0.3, lineHeight: 1.5,
      }}>
        <AlertTriangle size={12} style={{ marginRight: 5, verticalAlign: "middle", color: "#ffa500" }} />
        <strong style={{ color: "#ffa500" }}>For entertainment &amp; research only.</strong>{" "}
        Project Hype is <strong style={{ color: "#ffa500" }}>NOT financial advice</strong> and is <strong style={{ color: "#ffa500" }}>NOT a recommendation to buy, sell, or hold any currency or asset.</strong>{" "}
        Scores are based on automated signals and may be inaccurate. Always do your own research and consult a licensed financial advisor.
      </div>

      {/* Header */}
      <div style={{ position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{
          background: "linear-gradient(90deg, #070714 0%, #0d0d2e 50%, #070714 100%)",
          padding: isMobile ? "0 16px" : "0 40px", height: 64,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div
            onClick={() => window.location.href = "/"}
            style={{ display: "flex", alignItems: "center", gap: 16, cursor: "pointer" }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: "linear-gradient(135deg, #ff4d4d, #ff8c00)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 700, boxShadow: "0 0 20px #ff4d4d44"
            }}><Zap size={18} color="#fff" fill="#fff" /></div>
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 800, letterSpacing: 2, color: "#fff" }}>
                  PROJECT <span style={{ color: "#ff4d4d" }}>HYPE</span>
                </div>
                {!isMobile && <span style={{ fontSize: 10, color: "#5c5c8a", fontFamily: "'Space Mono',monospace" }}>v1.2.0</span>}
              </div>
              {!isMobile && <div style={{ fontSize: 10, color: "#8080aa", letterSpacing: 3, textTransform: "uppercase" }}>Speculative Currency Intelligence</div>}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 12 : 20 }}>
            <LiveDot secondsSince={secondsSince} />
            {!isMobile && <HeaderTicker currencies={currencies} />}
            {!isMobile && (
              <div style={{
                background: "#0d0d2e", border: "1px solid #1e1e3f",
                borderRadius: 20, padding: "4px 14px", fontSize: 12, color: "#8080aa"
              }}>
                {currencies.length} currencies tracked
              </div>
            )}
            {/* Alert bell */}
            <button
              onClick={() => {
                setAlertCodes(new Set([selected.code]));
                setAlertSubmitted(false);
                setAlertError("");
                setAlertModal(true);
              }}
              title="Set Catalyst Score alerts"
              aria-label="Alerts"
              style={{
                background: "none", border: "1px solid #1e1e3f", borderRadius: 8,
                color: "#8080aa", cursor: "pointer",
                padding: "5px 9px", lineHeight: 1, transition: "all 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#00b4ff"; e.currentTarget.style.color = "#00b4ff"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#1e1e3f"; e.currentTarget.style.color = "#8080aa"; }}
            ><Bell size={18} /></button>
          </div>
        </div>
        {/* Gradient accent line */}
        <div style={{ height: 1, background: "linear-gradient(90deg, transparent 0%, #00d4aa44 30%, #00b4ff44 70%, transparent 100%)" }} />
      </div>

      {/* Main Layout */}
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: isMobile ? "16px" : "32px 40px" }}>

        {/* Top section: tab content | sidebar — sidebar sticky scope is ONLY this div */}
        <div style={{
          display: isNarrow ? "block" : "grid",
          gridTemplateColumns: "1fr 380px",
          gap: 24,
          alignItems: "stretch",
          marginBottom: 24,
          minHeight: "calc(100vh - 128px)",
        }}>

        {/* Left: nav tabs + tab content */}
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 24 }}>

          {/* Nav Tabs */}
          <div className="tab-bar" style={{
            display: isMobile ? "grid" : "flex",
            gridTemplateColumns: isMobile ? "repeat(3, 1fr)" : undefined,
            gap: 4, background: "#0d0d1a", borderRadius: 10, padding: 4,
            ...(isMobile ? {} : { overflowX: "auto", WebkitOverflowScrolling: "touch", scrollbarWidth: "none", flexWrap: "nowrap" }),
          }}>
            {["calculator", "markets", "heatmap", "signals", "portfolio", "about"].map(tab => {
              const labelDesktop = tab === "calculator" ? <><Zap size={12} /> ROI Calculator</> : tab === "markets" ? <><BarChart2 size={12} /> Markets</> : tab === "heatmap" ? <><Flame size={12} /> Hype Map</> : tab === "signals" ? <><Target size={12} /> Signal Strength</> : tab === "about" ? <><Info size={12} /> About</> : <><Briefcase size={12} /> Portfolio{portfolio.length > 0 ? ` (${portfolio.length})` : ""}</>;
              const labelMobile = tab === "calculator" ? <><Zap size={11} /> ROI</> : tab === "markets" ? <><BarChart2 size={11} /> Markets</> : tab === "heatmap" ? <><Flame size={11} /> Hype</> : tab === "signals" ? <><Target size={11} /> Signals</> : tab === "about" ? <><Info size={11} /> About</> : <><Briefcase size={11} /> Portfolio{portfolio.length > 0 ? ` (${portfolio.length})` : ""}</>;
              return (
                <button key={tab} onClick={() => { setActiveTab(tab); trackEvent("tab_changed", { tab }); }} style={{
                  padding: isMobile ? "8px 4px" : "8px 20px", borderRadius: 8, border: "none", cursor: "pointer",
                  flexShrink: isMobile ? undefined : 0, minWidth: 0,
                  background: activeTab === tab ? "linear-gradient(135deg, #1e1e4f, #252560)" : "transparent",
                  color: activeTab === tab ? "#e8e8ff" : "#8080aa",
                  fontSize: isMobile ? 11 : 13, textTransform: "capitalize", fontWeight: 600,
                  transition: "all 0.2s", boxShadow: activeTab === tab ? "0 0 20px #252560" : "none",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  {isMobile ? labelMobile : labelDesktop}
                </button>
              );
            })}
          </div>

          {/* Tab content — flex:1 so this area always fills to the sidebar's bottom */}
          <div style={{ flex: 1, minHeight: "calc(100vh - 196px)", display: "flex", flexDirection: "column" }}>

          {activeTab === "calculator" && (
            <div style={{ animation: "slideIn 0.3s ease" }}>
              {/* Currency Selector + Inputs */}
              <div style={{
                background: "linear-gradient(135deg, #0d0d1a 0%, #111128 100%)",
                border: "1px solid #1e1e3f", borderRadius: 16, padding: isMobile ? 16 : 28,
                marginBottom: 20, animation: "glow 4s ease infinite"
              }}>
                <div style={{ marginBottom: 20 }}>
                  <label style={{ fontSize: 11, color: "#8080aa", letterSpacing: 2, textTransform: "uppercase", display: "block", marginBottom: 8 }}>
                    Select Currency
                  </label>
                  <CurrencySelect
                    currencies={currencies}
                    selected={selected}
                    onChange={c => { setSelected(c); trackEvent("currency_selected", { code: c.code, name: c.name }); }}
                  />
                </div>

                {/* Selected currency info */}
                <div style={{
                  background: "#070714", borderRadius: 10, padding: "14px 16px", marginBottom: 20
                }}>
                  <div style={{ fontSize: 24, marginBottom: 4 }}><FlagIcon code={selected.code} size={24} /></div>
                  <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Space Mono', monospace", color: "#00d4aa" }}>
                    {selected.rate.toFixed(8)} <span style={{ fontSize: 12, color: "#8080aa" }}>USD</span>
                    <RateBadge live={selected.live} source={selected.source} />
                    {selected.source === "analyst" && (
                      <span title="Official rate — black market rate may differ significantly" style={{ marginLeft: 6, cursor: "help" }}><AlertTriangle size={13} /></span>
                    )}
                    {selected.source === "scraped" && (
                      <span title={`Scraped from parallel-market tracker`} style={{ marginLeft: 6, cursor: "help" }}><Search size={13} /></span>
                    )}
                  </div>
                  <div style={{ marginTop: 4, marginBottom: 2, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 10, color: "#8080aa", letterSpacing: 1 }}>24H</span>
                    <ChangeChip value={selected.change_24h} />
                  </div>
                  <div style={{ fontSize: 12, color: "#8080aa", marginTop: 2 }}>
                    {selected.story}
                    <SanctionsBadge sanctions={selected.sanctions} />
                  </div>
                  <div style={{ fontSize: 10, color: "#4a4a6a", marginTop: 6 }}>
                    Rates: {selected.source === "oxr" ? "OXR" : selected.source === "exchangerate-api" ? "ExchangeRate-API" : selected.source === "scraped" ? "Scraped" : "EST"} · News: Tier 1+2+3 · Sentiment: {selected.sentiment_source === "claude" ? "Claude AI" : "Keyword"}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
                  <div>
                    <label style={{ fontSize: 11, color: "#8080aa", letterSpacing: 2, textTransform: "uppercase", display: "block", marginBottom: 8 }}>
                      Amount Held ({selected.code})
                    </label>
                    <input
                      type="number"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      style={{
                        width: "100%", padding: "12px 16px", boxSizing: "border-box",
                        background: "#070714", border: "1px solid #1e1e3f",
                        borderRadius: 8, color: "#e8e8ff", fontSize: 16,
                        fontFamily: "'Space Mono', monospace", fontWeight: 700
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: "#8080aa", letterSpacing: 2, textTransform: "uppercase", display: "block", marginBottom: 8 }}>
                      Target Rate (USD) <span style={{ color: "#1e1e3f" }}>optional</span>
                    </label>
                    <input
                      type="number"
                      placeholder="e.g. 0.001"
                      value={targetRate}
                      onChange={e => setTargetRate(e.target.value)}
                      style={{
                        width: "100%", padding: "12px 16px", boxSizing: "border-box",
                        background: "#070714", border: "1px solid #1e1e3f",
                        borderRadius: 8, color: "#ffa500", fontSize: 16,
                        fontFamily: "'Space Mono', monospace", fontWeight: 700
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Bidirectional currency converter */}
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 11, color: "#8080aa", letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>
                  Convert
                </div>
                <div style={{ display: "flex", alignItems: "stretch", borderRadius: 10, overflow: "hidden", border: "1px solid #1e1e3f" }}>
                  {/* USD side */}
                  <div style={{ flex: 1, background: "#070714", padding: "18px 22px" }}>
                    <div style={{ fontSize: 10, color: "#5a8a5a", letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>USD</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: "#5a8a5a", fontSize: 18, fontWeight: 700, fontFamily: "'Space Mono', monospace" }}>$</span>
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={usdBuy}
                        onChange={e => handleUsdBuyChange(e.target.value)}
                        style={{
                          flex: 1, background: "transparent", border: "none", outline: "none",
                          color: "#00d4aa", fontSize: 22, fontWeight: 700,
                          fontFamily: "'Space Mono', monospace", padding: 0, minWidth: 0
                        }}
                      />
                    </div>
                  </div>
                  {/* Swap divider */}
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    padding: "0 20px", background: "#0d0d1a",
                    color: "#3a3a5a", fontSize: 20, userSelect: "none", flexShrink: 0
                  }}>⇄</div>
                  {/* Currency side */}
                  <div style={{ flex: 1, background: "#070714", padding: "18px 22px" }}>
                    <div style={{ fontSize: 10, color: "#8080aa", letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>{selected.code}</div>
                    <input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={unitsBuy}
                      onChange={e => handleUnitsBuyChange(e.target.value)}
                      style={{
                        width: "100%", background: "transparent", border: "none", outline: "none",
                        color: "#e8e8ff", fontSize: 22, fontWeight: 700,
                        fontFamily: "'Space Mono', monospace", padding: 0, minWidth: 0,
                        boxSizing: "border-box"
                      }}
                    />
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "#3a3a5a", marginTop: 8 }}>
                  1 {selected.code} = {selected.rate.toFixed(8)} USD
                </div>
              </div>

              {/* Results */}
              {results ? (
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
                  <div style={{
                    background: "linear-gradient(135deg, #0d1a0d, #111e11)",
                    border: "1px solid #1a3a1a", borderRadius: 12, padding: "20px"
                  }}>
                    <div style={{ fontSize: 11, color: "#5a8a5a", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>Current Value</div>
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Space Mono', monospace", color: "#00d4aa" }}>
                      {fmt(results.currentVal)}
                    </div>
                    <div style={{ fontSize: 11, color: "#5a8a5a", marginTop: 6 }}>at {selected.rate.toFixed(8)} USD</div>
                  </div>
                  <div style={{
                    background: results.targetVal ? "linear-gradient(135deg, #1a1500, #1e1900)" : "linear-gradient(135deg, #0d0d1a, #111128)",
                    border: `1px solid ${results.targetVal ? "#3a3000" : "#1e1e3f"}`, borderRadius: 12, padding: "20px"
                  }}>
                    <div style={{ fontSize: 11, color: "#8a7a5a", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>Target Value</div>
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Space Mono', monospace", color: results.targetVal ? "#ffa500" : "#5c5c8a" }}>
                      {results.targetVal ? fmtFull(results.targetVal) : "—"}
                    </div>
                    {results.targetVal
                      ? <div style={{ fontSize: 11, color: "#8a7a5a", marginTop: 6 }}>at {parseFloat(targetRate).toFixed(8)} USD</div>
                      : <div style={{ fontSize: 11, color: "#5c5c8a", marginTop: 6 }}>Enter a target rate above ↑</div>
                    }
                  </div>
                  <div style={{
                    background: results.roi && parseFloat(results.roi) > 0 ? "linear-gradient(135deg, #0d1a1a, #111e1e)" : "linear-gradient(135deg, #1a0d0d, #1e1111)",
                    border: `1px solid ${results.roi ? (parseFloat(results.roi) > 0 ? "#1a3a3a" : "#3a1a1a") : "#1e1e3f"}`,
                    borderRadius: 12, padding: "20px"
                  }}>
                    <div style={{ fontSize: 11, color: "#5a8a8a", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>ROI</div>
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Space Mono', monospace", color: !results.roi ? "#5c5c8a" : parseFloat(results.roi) > 0 ? "#00d4aa" : "#ff4d4d" }}>
                      {results.roi ? `${parseFloat(results.roi) > 0 ? "+" : ""}${Number(results.roi).toLocaleString()}%` : "—"}
                    </div>
                    {results.gain != null && results.multiplier ? (
                      <div style={{ fontSize: 11, color: "#5a8a8a", marginTop: 6 }}>
                        {fmtFull(results.gain)} · {results.multiplier.toFixed(2)}x
                      </div>
                    ) : !results.roi ? (
                      <div style={{ fontSize: 11, color: "#5c5c8a", marginTop: 6 }}>Enter a target rate above ↑</div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div style={{
                  background: "#0d0d1a", border: "1px dashed #1e1e3f", borderRadius: 12,
                  padding: 24, textAlign: "center", color: "#5c5c8a", fontSize: 13, marginBottom: 20
                }}>
                  Enter an amount to calculate your current holdings value
                </div>
              )}

              {/* Market Context */}
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 16 }}>
                <StatCard label="Market Cap" value={selected.mcap === "N/A" ? "—" : `$${selected.mcap}`} sub={selected.mcap === "N/A" ? "No reliable data" : "Estimated"} />
                <StatCard label="24h Volume" value={selected.vol === "N/A" ? "—" : `$${selected.vol}`} sub={selected.vol === "N/A" ? "No reliable data" : "Reported"} />
                <div style={{
                  background: "linear-gradient(135deg, #0d0d1a 0%, #111128 100%)",
                  border: "1px solid #1e1e3f", borderRadius: 12, padding: "18px 20px", flex: 1
                }}>
                  <div style={{ fontSize: 10, color: "#8080aa", letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>HYPE <span style={{ color: "#8080aa" }}>· noise</span></div>
                  <HypeBar score={Math.round(selected.hype_score ?? selected.hype)} />
                  {selected.catalyst_score != null ? (
                    <>
                      <div style={{ fontSize: 10, color: "#9b59b6", letterSpacing: 2, textTransform: "uppercase", marginTop: 10, marginBottom: 6 }}>
                        CATALYST <span style={{ color: "#8080aa", textTransform: "none", letterSpacing: 0.5 }}>· appreciation potential</span>
                      </div>
                      <CatalystBar score={Math.round(selected.catalyst_score)} />
                    </>
                  ) : (
                    <div style={{ fontSize: 11, color: "#8080aa", marginTop: 8 }}>
                      {(selected.hype_score ?? selected.hype) >= 80 ? <><Flame size={12} /> Extreme speculation</> : (selected.hype_score ?? selected.hype) >= 55 ? <><Zap size={12} /> Elevated interest</> : <><BarChart2 size={12} /> Moderate tracking</>}
                    </div>
                  )}
                </div>
              </div>

              {/* Catalyst Signal */}
              {selected.catalyst_score != null && (() => {
                const cat = selected.catalyst_score;
                const sent = selected.sentiment ?? 0;
                const mom = selected.momentum_7d ?? 0;
                const comm = selected.commodity_signal;
                const catColor = cat >= 65 ? "#00d4aa" : cat >= 40 ? "#ffa500" : "#ff4d4d";
                const sentLabel = sent > 10 ? "Bullish narrative" : sent < -10 ? "Bearish narrative" : "Neutral narrative";
                const momLabel = mom > 0.5 ? `+${mom.toFixed(2)}% 7d momentum` : mom < -0.5 ? `${mom.toFixed(2)}% 7d decline` : "Flat rate trend";
                const signal = cat >= 65 ? "High speculative signal activity" : cat >= 40 ? "Mixed signals — limited catalyst data" : "Low signal activity";
                const driver = COMMODITY_DRIVER[selected.code];
                const commColor = comm == null ? null : comm > 55 ? "#00d4aa" : comm < 45 ? "#ff4d4d" : "#8080aa";
                const commLabel = comm == null ? null
                  : comm > 55 ? `${driver || "Commodity"}: bullish`
                  : comm < 45 ? `${driver || "Commodity"}: bearish`
                  : driver ? `${driver}: neutral` : null;
                return (
                  <div style={{
                    background: "linear-gradient(135deg, #0d0d1a 0%, #111128 100%)",
                    border: `1px solid ${catColor}33`, borderRadius: 12, padding: "18px 20px", marginTop: 16
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                      <div>
                        <div style={{ fontSize: 11, color: "#8080aa", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}><Target size={11} /> Signal Strength</div>
                        <div style={{ fontSize: 11, color: catColor }}>{signal}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'Space Mono', monospace", color: catColor }}>{Math.round(cat)}</div>
                        <div style={{ fontSize: 10, color: "#8080aa" }}>/ 100</div>
                      </div>
                    </div>
                    <div style={{ height: 6, background: "#1a1a2e", borderRadius: 3, overflow: "hidden", marginBottom: 12 }}>
                      <div style={{ width: `${cat}%`, height: "100%", background: catColor, borderRadius: 3, boxShadow: `0 0 8px ${catColor}` }} />
                    </div>
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
                      <div style={{ fontSize: 11, color: sent > 10 ? "#00d4aa" : sent < -10 ? "#ff4d4d" : "#8080aa", display: "flex", alignItems: "center", gap: 4 }}>
                        <Newspaper size={11} /> {sentLabel}
                      </div>
                      <div style={{ fontSize: 11, color: mom > 0.5 ? "#00d4aa" : mom < -0.5 ? "#ff4d4d" : "#8080aa", display: "flex", alignItems: "center", gap: 4 }}>
                        <TrendingUp size={11} /> {momLabel}
                      </div>
                      {commLabel && (
                        <div style={{ fontSize: 11, color: commColor, display: "flex", alignItems: "center", gap: 4 }}>
                          <BarChart2 size={11} /> {commLabel}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: catColor, borderTop: "1px solid #1a1a2e", paddingTop: 8 }}>
                      Signal strength reflects news sentiment, rate movement{driver ? ", and commodity trends" : ""} — not a prediction or investment advice.
                    </div>
                  </div>
                );
              })()}

            </div>
          )}

          {activeTab === "markets" && (
            <div style={{ animation: "slideIn 0.3s ease" }}>
              {/* Search */}
              <div style={{ position: "relative", marginBottom: 12 }}>
                <input
                  placeholder="Search currencies..."
                  value={marketSearch}
                  onChange={e => setMarketSearch(e.target.value)}
                  style={{
                    width: "100%", padding: "10px 16px", boxSizing: "border-box",
                    background: "#0d0d1a", border: "1px solid #1e1e3f",
                    borderRadius: 8, color: "#e8e8ff", fontSize: 13,
                  }}
                />
                {marketSearch && (
                  <button onClick={() => setMarketSearch("")} style={{
                    position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", color: "#8080aa", cursor: "pointer", fontSize: 16,
                  }}>×</button>
                )}
              </div>

              {(() => {
                const isSearching = marketSearch.trim().length > 0;
                let visible;
                if (isSearching) {
                  visible = currencies.filter(c =>
                    c.code.toLowerCase().includes(marketSearch.toLowerCase()) ||
                    c.name.toLowerCase().includes(marketSearch.toLowerCase())
                  );
                } else if (marketSort === "catalyst") {
                  visible = [...currencies]
                    .sort((a, b) => (b.catalyst_score ?? -1) - (a.catalyst_score ?? -1))
                    .slice(0, 15);
                } else {
                  visible = [...currencies]
                    .sort((a, b) => (b.hype_score ?? b.hype) - (a.hype_score ?? a.hype))
                    .slice(0, 15);
                }

                if (isMobile) {
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ display: "flex", gap: 8, fontSize: 10, color: "#8080aa", letterSpacing: 2, textTransform: "uppercase", padding: "0 4px" }}>
                        <span>Sort:</span>
                        <span
                          onClick={() => setMarketSort("hype")}
                          style={{ cursor: "pointer", color: marketSort === "hype" ? "#ffa500" : "#8080aa", userSelect: "none" }}
                        >Hype {marketSort === "hype" ? "▼" : ""}</span>
                        <span
                          onClick={() => setMarketSort("catalyst")}
                          style={{ cursor: "pointer", color: marketSort === "catalyst" ? "#00b4ff" : "#8080aa", userSelect: "none" }}
                        >Catalyst {marketSort === "catalyst" ? "▼" : ""}</span>
                      </div>
                      {visible.map(c => {
                        const isSelected = selected.code === c.code;
                        const hs = Math.round(c.hype_score ?? c.hype);
                        const hypeColor = hs >= 80 ? "#ff4d4d" : hs >= 55 ? "#ffa500" : "#00d4aa";
                        const cat = c.catalyst_score;
                        const catCol = cat != null ? catalystColor(cat) : "#3a3a55";
                        return (
                          <div
                            key={c.code}
                            onClick={() => { setSelected(c); setActiveTab("calculator"); }}
                            style={{
                              background: isSelected ? "#11122a" : "#0d0d1a",
                              border: `1px solid ${isSelected ? "#1e3a5f" : "#1e1e3f"}`,
                              borderLeft: `3px solid ${isSelected ? "#00d4aa" : "#1e1e3f"}`,
                              borderRadius: 10, padding: "14px 14px 12px", cursor: "pointer",
                              display: "flex", flexDirection: "column", gap: 12,
                            }}
                          >
                            {/* Header: flag + code + name + change */}
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <FlagIcon code={c.code} size={22} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <span style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 14, color: "#00d4aa", letterSpacing: 0.5 }}>{c.code}</span>
                                  <SanctionsBadge sanctions={c.sanctions} />
                                </div>
                                <div style={{ fontSize: 11, color: "#8080aa", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
                              </div>
                              <div style={{ flexShrink: 0 }}>
                                <ChangeChip value={c.change_24h} />
                              </div>
                            </div>

                            {/* Rate row */}
                            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 15, color: "#e8e8ff", fontWeight: 700 }}>{c.rate.toFixed(8)}</span>
                              <span style={{ fontSize: 9, color: "#8080aa", letterSpacing: 1 }}>USD</span>
                              <RateBadge live={c.live} source={c.source} />
                              <div style={{ marginLeft: "auto", fontSize: 11, color: "#5c5c8a", fontFamily: "'Space Mono', monospace" }}>
                                {c.mcap === "N/A" ? "" : `$${c.mcap}`}
                              </div>
                            </div>

                            {/* Score bars: HYPE + CATALYST side by side */}
                            <div style={{ display: "flex", gap: 14 }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                                  <span style={{ fontSize: 9, color: "#8080aa", letterSpacing: 1.5 }}>HYPE</span>
                                  <span style={{ fontSize: 12, fontFamily: "'Space Mono', monospace", fontWeight: 700, color: hypeColor }}>{hs}</span>
                                </div>
                                <div style={{ height: 3, background: "#1a1a2e", borderRadius: 2, overflow: "hidden" }}>
                                  <div style={{ width: `${hs}%`, height: "100%", background: hypeColor, boxShadow: `0 0 6px ${hypeColor}` }} />
                                </div>
                              </div>
                              <div style={{ flex: 1 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                                  <span style={{ fontSize: 9, color: "#8080aa", letterSpacing: 1.5 }}>CATALYST</span>
                                  <span style={{ fontSize: 12, fontFamily: "'Space Mono', monospace", fontWeight: 700, color: catCol }}>
                                    {cat != null ? Math.round(cat) : "—"}
                                  </span>
                                </div>
                                <div style={{ height: 3, background: "#1a1a2e", borderRadius: 2, overflow: "hidden" }}>
                                  <div style={{ width: `${cat ?? 0}%`, height: "100%", background: catCol, boxShadow: cat != null ? `0 0 6px ${catCol}` : "none" }} />
                                </div>
                              </div>
                            </div>

                            {/* Actions */}
                            <div style={{ display: "flex", gap: 8 }}>
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  setPortfolio(prev => {
                                    const existing = prev.findIndex(p => p.code === c.code);
                                    if (existing >= 0) {
                                      const updated = [...prev];
                                      updated[existing] = { ...updated[existing], amount: updated[existing].amount + 1 };
                                      return updated;
                                    }
                                    return [...prev, { code: c.code, amount: 1, addedAt: Date.now() }];
                                  });
                                }}
                                style={{
                                  flex: 1, background: "#070714", border: "1px solid #1e1e3f", borderRadius: 7,
                                  color: "#00d4aa", fontSize: 11, fontWeight: 700, cursor: "pointer",
                                  padding: "8px 10px", letterSpacing: 0.5,
                                }}
                              >+ PORTFOLIO</button>
                              <button
                                onClick={e => { e.stopPropagation(); setBuyModal(c); trackEvent("buy_modal_opened", { code: c.code }); }}
                                style={{
                                  flex: 1, background: "#070714", border: "1px solid #1e1e3f", borderRadius: 7,
                                  color: "#00b4ff", fontSize: 11, fontWeight: 700, cursor: "pointer",
                                  padding: "8px 10px", letterSpacing: 0.5,
                                }}
                              >HOW TO BUY</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                }

                return (
                  <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", borderRadius: 12, border: "1px solid #1e1e3f" }}>
                  <div style={{ background: "#0d0d1a", borderRadius: 12, overflow: "hidden", minWidth: 800 }}>
                    <div style={{
                      display: "grid", gridTemplateColumns: "40px 80px 1fr 120px 75px 75px 70px 70px 80px 36px 44px",
                      gap: 10, padding: "12px 20px", borderBottom: "1px solid #1e1e3f",
                      alignItems: "center",
                      fontSize: 10, color: "#8080aa", letterSpacing: 2, textTransform: "uppercase"
                    }}>
                      <div></div><div>Code</div><div>Name</div><div>Rate (USD)</div><div style={{ textAlign: "center" }}>24h</div><div>Market Cap</div>
                      <div
                        style={{ cursor: "pointer", color: marketSort === "hype" ? "#ffa500" : "#8080aa", userSelect: "none" }}
                        onClick={() => setMarketSort("hype")}
                        title="Sort by Hype Score"
                      >Hype {marketSort === "hype" ? "▼" : ""}</div>
                      <div
                        style={{ cursor: "pointer", color: marketSort === "catalyst" ? "#00b4ff" : "#8080aa", userSelect: "none" }}
                        onClick={() => setMarketSort("catalyst")}
                        title="Sort by Catalyst Score"
                      >Cat {marketSort === "catalyst" ? "▼" : ""}</div>
                      <div>Story</div><div></div><div></div>
                    </div>
                    {visible.map((c) => {
                      const isSelected = selected.code === c.code;
                      return (
                        <div
                          key={c.code}
                          onClick={() => { setSelected(c); setActiveTab("calculator"); }}
                          style={{
                            display: "grid", gridTemplateColumns: "40px 80px 1fr 120px 75px 75px 70px 70px 80px 36px 44px",
                            gap: 10, padding: "12px 20px", cursor: "pointer",
                            alignItems: "center",
                            borderBottom: "1px solid #0d0d1a",
                            borderLeft: isSelected ? "3px solid #00d4aa" : "3px solid transparent",
                            background: isSelected ? "#111128" : "transparent",
                            transition: "background 0.15s",
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = "#0f0f24"}
                          onMouseLeave={e => e.currentTarget.style.background = isSelected ? "#111128" : "transparent"}
                        >
                          <FlagIcon code={c.code} size={18} />
                          <div style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 13, color: "#00d4aa" }}>{c.code}</div>
                          <div style={{ fontSize: 13, color: "#9999cc", display: "flex", alignItems: "center", gap: 4 }}>{c.name}<SanctionsBadge sanctions={c.sanctions} /></div>
                          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: "#e8e8ff", display: "flex", alignItems: "center", gap: 4 }}>
                            {c.rate.toFixed(8)}
                            <RateBadge live={c.live} source={c.source} />
                          </div>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}><ChangeChip value={c.change_24h} /></div>
                          <div style={{ fontSize: 12, color: "#8080aa" }}>{c.mcap === "N/A" ? "—" : `$${c.mcap}`}</div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: (c.hype_score ?? c.hype) >= 80 ? "#ff4d4d" : (c.hype_score ?? c.hype) >= 55 ? "#ffa500" : "#00d4aa" }}
                            title={`Hype Score ${Math.round(c.hype_score ?? c.hype)}/100`}>
                            {Math.round(c.hype_score ?? c.hype)}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}
                            title={c.catalyst_score != null ? `Catalyst Score ${Math.round(c.catalyst_score)}/100 — forward-looking appreciation potential` : "Catalyst score pending"}>
                            {c.catalyst_score != null ? (
                              <>
                                <div style={{ width: 7, height: 7, borderRadius: "50%", background: catalystColor(c.catalyst_score), boxShadow: `0 0 4px ${catalystColor(c.catalyst_score)}`, flexShrink: 0 }} />
                                <span style={{ fontSize: 12, fontWeight: 700, color: catalystColor(c.catalyst_score), fontFamily: "'Space Mono', monospace" }}>{Math.round(c.catalyst_score)}</span>
                              </>
                            ) : (
                              <span style={{ fontSize: 10, color: "#8080aa" }}>—</span>
                            )}
                          </div>
                          <div style={{ fontSize: 10, color: "#8080aa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.story.split(",")[0]}</div>
                          <div style={{ display: "flex", alignItems: "center" }}>
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                setPortfolio(prev => {
                                  const existing = prev.findIndex(p => p.code === c.code);
                                  if (existing >= 0) {
                                    const updated = [...prev];
                                    updated[existing] = { ...updated[existing], amount: updated[existing].amount + 1 };
                                    return updated;
                                  }
                                  return [...prev, { code: c.code, amount: 1, addedAt: Date.now() }];
                                });
                              }}
                              title={`Add 1 ${c.code} to portfolio`}
                              style={{
                                background: "none", border: "1px solid #1e1e3f", borderRadius: 5,
                                color: "#8080aa", fontSize: 13, cursor: "pointer",
                                padding: "2px 6px", lineHeight: 1, transition: "all 0.15s",
                              }}
                              onMouseEnter={e => { e.currentTarget.style.borderColor = "#00d4aa"; e.currentTarget.style.color = "#00d4aa"; }}
                              onMouseLeave={e => { e.currentTarget.style.borderColor = "#1e1e3f"; e.currentTarget.style.color = "#8080aa"; }}
                            >+</button>
                          </div>
                          <div style={{ display: "flex", alignItems: "center" }}>
                            <button
                              onClick={e => { e.stopPropagation(); setBuyModal(c); trackEvent("buy_modal_opened", { code: c.code }); }}
                              title={`How to buy ${c.code}`}
                              style={{
                                background: "none", border: "1px solid #1e1e3f", borderRadius: 5,
                                color: "#8080aa", fontSize: 10, cursor: "pointer",
                                padding: "2px 5px", lineHeight: 1, transition: "all 0.15s", whiteSpace: "nowrap",
                              }}
                              onMouseEnter={e => { e.currentTarget.style.borderColor = "#00b4ff"; e.currentTarget.style.color = "#00b4ff"; }}
                              onMouseLeave={e => { e.currentTarget.style.borderColor = "#1e1e3f"; e.currentTarget.style.color = "#8080aa"; }}
                            >Buy</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  </div>
                );
              })()}
              {(() => {
                const isSearching = marketSearch.trim().length > 0;
                const matchCount = currencies.filter(c =>
                  c.code.toLowerCase().includes(marketSearch.toLowerCase()) ||
                  c.name.toLowerCase().includes(marketSearch.toLowerCase())
                ).length;
                if (isSearching && matchCount === 0) return (
                  <div style={{ textAlign: "center", padding: "14px 0", fontSize: 11, color: "#8080aa" }}>
                    No currencies match "{marketSearch}"
                  </div>
                );
                if (!isSearching) return (
                  <div style={{ textAlign: "center", padding: "14px 0", fontSize: 11, color: "#8080aa" }}>
                    Showing top 15 by {marketSort === "catalyst" ? "catalyst score" : "hype score"} — search to find any currency
                  </div>
                );
                return null;
              })()}
            </div>
          )}

          {activeTab === "portfolio" && (() => {
            const totalUSD = portfolio.reduce((sum, p) => {
              const cur = currencies.find(c => c.code === p.code);
              return sum + (cur ? cur.rate * p.amount : 0);
            }, 0);

            return (
              <div style={{ animation: "slideIn 0.3s ease", display: "flex", flexDirection: "column", gap: 20, flex: 1 }}>

                {/* Shared-view banner */}
                {isSharedView && (
                  <div style={{
                    background: "linear-gradient(135deg, #0d1a2e, #111e3a)",
                    border: "1px solid #1e3a6e", borderRadius: 12,
                    padding: "14px 20px", display: "flex", alignItems: "center",
                    justifyContent: "space-between", gap: 12,
                  }}>
                    <div style={{ fontSize: 13, color: "#7799cc", display: "flex", alignItems: "center", gap: 6 }}>
                      <Eye size={13} /> Viewing a shared portfolio
                    </div>
                    <button
                      onClick={() => {
                        setIsSharedView(false);
                        window.history.replaceState({}, "", window.location.pathname);
                      }}
                      style={{
                        padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer",
                        background: "linear-gradient(135deg, #1e1e4f, #252560)",
                        color: "#e8e8ff", fontSize: 11, fontWeight: 700, letterSpacing: 1,
                        flexShrink: 0,
                      }}
                    >
                      SAVE AS MY OWN
                    </button>
                  </div>
                )}

                {/* Add Position */}
                <div style={{
                  background: "linear-gradient(135deg, #0d0d1a 0%, #111128 100%)",
                  border: "1px solid #1e1e3f", borderRadius: 16, padding: isMobile ? 16 : 24,
                }}>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: 1, marginBottom: 16 }}>
                    + ADD POSITION
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginBottom: 12 }}>
                    <div>
                      <label style={{ fontSize: 11, color: "#8080aa", letterSpacing: 2, textTransform: "uppercase", display: "block", marginBottom: 8 }}>Currency</label>
                      <CurrencySelect
                        currencies={currencies}
                        selected={currencies.find(c => c.code === (pfCode || currencies[0]?.code))}
                        onChange={c => setPfCode(c.code)}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: "#8080aa", letterSpacing: 2, textTransform: "uppercase", display: "block", marginBottom: 8 }}>Amount</label>
                      <input
                        type="number"
                        placeholder="e.g. 1000000"
                        value={pfAmount}
                        onChange={e => setPfAmount(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && addPosition()}
                        style={{
                          width: "100%", padding: "10px 14px", boxSizing: "border-box",
                          background: "#070714", border: "1px solid #1e1e3f",
                          borderRadius: 8, color: "#e8e8ff", fontSize: 14,
                          fontFamily: "'Space Mono', monospace", fontWeight: 700,
                        }}
                      />
                    </div>
                  </div>
                  <button
                    onClick={addPosition}
                    style={{
                      width: "100%", padding: "12px", borderRadius: 8, border: "none", cursor: "pointer",
                      background: "linear-gradient(135deg, #1e1e4f, #252560)",
                      color: "#e8e8ff", fontSize: 13, fontWeight: 700, letterSpacing: 1,
                      boxShadow: "0 0 20px #25256044", transition: "opacity 0.15s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.opacity = "0.8"}
                    onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                  >
                    ADD TO PORTFOLIO
                  </button>
                </div>

                {/* Total Value Banner */}
                {portfolio.length > 0 && (
                  <div style={{
                    background: "linear-gradient(135deg, #0d1a0d 0%, #111e11 100%)",
                    border: "1px solid #1a3a1a", borderRadius: 16, padding: "20px 24px",
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
                  }}>
                    <div>
                      <div style={{ fontSize: 11, color: "#5a8a5a", letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>Total Portfolio Value</div>
                      <div style={{ fontSize: 32, fontWeight: 700, fontFamily: "'Space Mono', monospace", color: "#00d4aa" }}>
                        {fmt(totalUSD)}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 11, color: "#5a8a5a", letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>Positions</div>
                        <div style={{ fontSize: 32, fontWeight: 700, fontFamily: "'Space Mono', monospace", color: "#e8e8ff" }}>
                          {portfolio.length}
                        </div>
                      </div>
                      <button
                        onClick={sharePortfolio}
                        disabled={shareLoading}
                        style={{
                          padding: "8px 18px", borderRadius: 8, cursor: "pointer",
                          background: "linear-gradient(135deg, #1e3a1e, #253a25)",
                          border: "1px solid #00d4aa33",
                          color: "#00d4aa", fontSize: 12, fontWeight: 700, letterSpacing: 1,
                          transition: "opacity 0.15s",
                          opacity: shareLoading ? 0.5 : 1,
                        }}
                        onMouseEnter={e => e.currentTarget.style.opacity = "0.75"}
                        onMouseLeave={e => e.currentTarget.style.opacity = shareLoading ? "0.5" : "1"}
                      >
                        {shareLoading ? "…" : <><Link2 size={12} /> SHARE</>}
                      </button>
                    </div>
                  </div>
                )}

                {/* Position Rows */}
                {portfolio.length === 0 ? (
                  <div style={{
                    background: "#0d0d1a", border: "1px dashed #1e1e3f", borderRadius: 16,
                    padding: "40px 24px", textAlign: "center", flex: 1,
                  }}>
                    <div style={{ marginBottom: 12 }}><Briefcase size={40} color="#8080aa" /></div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#8080aa", marginBottom: 6 }}>No positions yet</div>
                    <div style={{ fontSize: 13, color: "#5c5c8a", lineHeight: 1.6 }}>
                      Add your first position above, or use the <strong style={{ color: "#8080aa" }}>+</strong> button in the Markets table to add a currency instantly.
                    </div>
                  </div>
                ) : (
                  <div style={{ background: "#0d0d1a", borderRadius: 16, border: "1px solid #1e1e3f", overflow: "hidden" }}>
                    {portfolio.map((p, i) => {
                      const cur = currencies.find(c => c.code === p.code);
                      if (!cur) return null;
                      const posValue = cur.rate * p.amount;
                      const pct = totalUSD > 0 ? (posValue / totalUSD) * 100 : 0;
                      const hypeColor = (cur.hype_score ?? cur.hype) >= 80 ? "#ff4d4d" : (cur.hype_score ?? cur.hype) >= 55 ? "#ffa500" : "#00d4aa";
                      return (
                        <div key={p.code} style={{
                          padding: "16px 20px",
                          borderBottom: i < portfolio.length - 1 ? "1px solid #0f0f22" : "none",
                          display: "flex", alignItems: "center", gap: 14,
                        }}>
                          <FlagIcon code={cur.code} size={26} style={{ flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                              <span style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 14, color: "#00d4aa" }}>{cur.code}</span>
                              <span style={{ fontSize: 12, color: "#8080aa" }}>{cur.name}</span>
                              <RateBadge live={cur.live} source={cur.source} />
                            </div>
                            <div style={{ fontSize: 12, color: "#9999cc", marginBottom: 6 }}>
                              {p.amount.toLocaleString()} units · {cur.rate.toFixed(8)} USD
                            </div>
                            {/* Portfolio weight bar */}
                            <div style={{ height: 3, background: "#1a1a2e", borderRadius: 2, overflow: "hidden" }}>
                              <div style={{
                                width: `${pct}%`, height: "100%", background: hypeColor,
                                borderRadius: 2, transition: "width 0.6s ease",
                                boxShadow: `0 0 6px ${hypeColor}`,
                              }} />
                            </div>
                            <div style={{ fontSize: 10, color: "#8080aa", marginTop: 4 }}>{pct.toFixed(1)}% of portfolio</div>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 16, color: "#e8e8ff" }}>
                              {fmt(posValue)}
                            </div>
                            <div style={{ fontSize: 11, color: hypeColor, fontWeight: 700 }}>
                              HYPE {Math.round(cur.hype_score ?? cur.hype)}
                            </div>
                            {cur.catalyst_score != null && (
                              <div style={{ fontSize: 11, color: catalystColor(cur.catalyst_score), fontWeight: 700, marginTop: 2 }}>
                                <Zap size={11} style={{ verticalAlign: "middle" }} /> CAT {Math.round(cur.catalyst_score)}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => removePosition(p.code)}
                            title="Remove position"
                            style={{
                              background: "none", border: "1px solid #1e1e3f", borderRadius: 6,
                              color: "#8080aa", fontSize: 14, cursor: "pointer",
                              padding: "4px 8px", flexShrink: 0, lineHeight: 1, transition: "all 0.15s",
                            }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = "#ff4d4d"; e.currentTarget.style.color = "#ff4d4d"; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = "#1e1e3f"; e.currentTarget.style.color = "#8080aa"; }}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {activeTab === "heatmap" && (
            <div style={{
              animation: "slideIn 0.3s ease", flex: 1, display: "flex", flexDirection: "column",
              background: "linear-gradient(135deg, #0d0d1a 0%, #111128 100%)",
              border: "1px solid #1e1e3f", borderRadius: 16, padding: isMobile ? 16 : 24,
            }}>
              <div style={{ marginBottom: 16, color: "#8080aa", fontSize: 13 }}>
                Tile size = hype score. Color = intensity. Click to analyze.
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {[...currencies].sort((a, b) => (b.hype_score ?? b.hype) - (a.hype_score ?? a.hype)).map(c => {
                  const hs = c.hype_score ?? c.hype;
                  const size = 40 + (hs / 100) * 60;
                  const alpha = 0.2 + (hs / 100) * 0.8;
                  const color = hs >= 80 ? `rgba(255,77,77,${alpha})` : hs >= 55 ? `rgba(255,165,0,${alpha})` : `rgba(0,212,170,${alpha})`;
                  return (
                    <div
                      key={c.code}
                      onClick={() => { setSelected(c); setActiveTab("calculator"); trackEvent("heatmap_click", { code: c.code }); }}
                      style={{
                        width: size, height: size, background: color,
                        borderRadius: 8, display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "center",
                        cursor: "pointer", transition: "transform 0.15s, box-shadow 0.15s",
                        border: `1px solid ${color}`,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.1)"; e.currentTarget.style.boxShadow = `0 0 20px ${color}`; }}
                      onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "none"; }}
                      title={`${c.name} — Hype: ${Math.round(c.hype_score ?? c.hype)}`}
                    >
                      <FlagIcon code={c.code} size={Math.max(8, Math.round(size / 5))} />
                      <div style={{ fontSize: Math.max(7, size / 6), fontWeight: 700, fontFamily: "'Space Mono', monospace", color: "#fff", marginTop: 2 }}>{c.code}</div>
                      {size > 70 && <div style={{ fontSize: 9, color: "rgba(255,255,255,0.7)" }}>{Math.round(c.hype_score ?? c.hype)}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Signals Tab ─────────────────────────────────────────────── */}
          {activeTab === "signals" && (
            <div style={{ animation: "slideIn 0.3s ease", flex: 1, display: "flex", flexDirection: "column" }}>
              <div style={{
                background: "linear-gradient(135deg, #0d0d1a 0%, #111128 100%)",
                border: "1px solid #1e1e3f", borderRadius: 16, padding: isMobile ? 16 : 24, flex: 1
              }}>
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: isMobile ? 13 : 18, letterSpacing: isMobile ? 0 : 1, marginBottom: 6 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Target size={isMobile ? 13 : 18} />{isMobile ? "SIGNAL STRENGTH" : "SPECULATIVE SIGNAL STRENGTH"}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#8080aa", lineHeight: 1.6 }}>
                    Currencies ranked by <strong style={{ color: "#9999cc" }}>Catalyst Score</strong> — a composite of news sentiment and 7-day rate momentum. High scores indicate active narratives and recent movement, <strong style={{ color: "#7a6a40" }}>not a prediction or recommendation</strong>. Updated every 12 hours.
                  </div>
                </div>

                {/* Legend */}
                <div style={{ display: "flex", gap: isMobile ? 8 : 16, marginBottom: 20, flexWrap: isMobile ? "nowrap" : "wrap" }}>
                  {[["#00d4aa", "Bullish", ">10 sent."], ["#8080aa", "Neutral", "±10"], ["#ff4d4d", "Bearish", "<−10 sent."]].map(([color, label, sub]) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: isMobile ? 4 : 6, minWidth: 0 }}>
                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
                      <span style={{ fontSize: isMobile ? 10 : 11, color, fontWeight: 700, whiteSpace: "nowrap" }}>{label}</span>
                      <span style={{ fontSize: isMobile ? 9 : 10, color: "#8080aa", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</span>
                    </div>
                  ))}
                </div>

                {/* Search bar */}
                <div style={{ position: "relative", marginBottom: 16 }}>
                  <input
                    placeholder="Search currencies..."
                    value={signalSearch}
                    onChange={e => setSignalSearch(e.target.value)}
                    style={{
                      width: "100%", padding: "10px 16px", boxSizing: "border-box",
                      background: "#070714", border: "1px solid #1e1e3f",
                      borderRadius: 8, color: "#e8e8ff", fontSize: 13,
                    }}
                  />
                  {signalSearch && (
                    <button onClick={() => setSignalSearch("")} style={{
                      position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                      background: "none", border: "none", color: "#8080aa", cursor: "pointer", fontSize: 16,
                    }}>×</button>
                  )}
                </div>

                {/* Table header */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "16px 20px 1fr auto" : "28px 32px 160px 1fr 90px 72px",
                  gap: isMobile ? 6 : 10, padding: isMobile ? "8px 4px" : "8px 12px",
                  fontSize: 9, color: "#8080aa", letterSpacing: 2, textTransform: "uppercase",
                  borderBottom: "1px solid #1e1e3f"
                }}>
                  {isMobile ? (
                    <><div>#</div><div></div><div>Currency</div><div style={{ textAlign: "right" }}>Cat · Sent · 7d</div></>
                  ) : (
                    <><div>#</div><div></div><div>Currency</div><div>Signal</div><div>Sentiment</div><div>7d Move</div></>
                  )}
                </div>

                {(() => {
                  const TOP_N = 10;
                  const sorted = [...currencies]
                    .filter(c => c.catalyst_score != null)
                    .sort((a, b) => b.catalyst_score - a.catalyst_score);
                  const isSearching = signalSearch.trim().length > 0;
                  const visible = isSearching
                    ? sorted.filter(c =>
                        c.code.toLowerCase().includes(signalSearch.toLowerCase()) ||
                        c.name.toLowerCase().includes(signalSearch.toLowerCase())
                      )
                    : sorted.slice(0, TOP_N);
                  return visible;
                })().map((c, i) => {
                    const cat = c.catalyst_score ?? 0;
                    const sent = c.sentiment ?? 0;
                    const mom = c.momentum_7d ?? 0;
                    const catColor = cat >= 65 ? "#00d4aa" : cat >= 40 ? "#ffa500" : "#ff4d4d";
                    const sentColor = sent > 10 ? "#00d4aa" : sent < -10 ? "#ff4d4d" : "#8080aa";
                    const momColor = mom > 0 ? "#00d4aa" : mom < 0 ? "#ff4d4d" : "#8080aa";
                    const sentLabel = sent > 10 ? "BULLISH" : sent < -10 ? "BEARISH" : "NEUTRAL";
                    return (
                      <div
                        key={c.code}
                        onClick={() => { setSelected(c); setActiveTab("calculator"); }}
                        style={{
                          display: "grid",
                          gridTemplateColumns: isMobile ? "16px 20px 1fr auto" : "28px 32px 160px 1fr 90px 72px",
                          gap: isMobile ? 6 : 10, padding: isMobile ? "10px 4px" : "12px 12px", cursor: "pointer",
                          borderBottom: "1px solid #0d0d1a",
                          background: selected.code === c.code ? "#111128" : "transparent",
                          transition: "background 0.15s",
                          borderRadius: i === 0 ? "8px 8px 0 0" : 0,
                          alignItems: "center",
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = "#0f0f24"}
                        onMouseLeave={e => e.currentTarget.style.background = selected.code === c.code ? "#111128" : "transparent"}
                      >
                        {/* Rank */}
                        <div style={{ fontSize: 10, color: "#5c5c8a", fontFamily: "'Space Mono', monospace" }}>{i + 1}</div>

                        {/* Flag */}
                        <FlagIcon code={c.code} size={isMobile ? 16 : 20} />

                        {isMobile ? (
                          <>
                            {/* Code + name */}
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 11, color: "#e8e8ff" }}>{c.code}</div>
                              <div style={{ fontSize: 9, color: "#8080aa", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
                            </div>

                            {/* All three signals on one row, baseline-aligned */}
                            <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "'Space Mono', monospace" }}>
                              <span style={{ fontWeight: 700, fontSize: 13, color: catColor, minWidth: 22, textAlign: "right" }}>
                                {Math.round(cat)}
                              </span>
                              <span style={{
                                fontSize: 8, fontWeight: 700, padding: "2px 5px", borderRadius: 4,
                                color: sentColor, background: `${sentColor}18`,
                                border: `1px solid ${sentColor}33`, whiteSpace: "nowrap",
                              }}>{sentLabel}</span>
                              <span style={{ fontSize: 10, color: momColor, fontWeight: 700, minWidth: 38, textAlign: "right" }}>
                                {mom > 0 ? "+" : ""}{mom.toFixed(1)}%
                              </span>
                            </div>
                          </>
                        ) : (
                          <>
                            {/* Name */}
                            <div>
                              <div style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 12, color: "#e8e8ff" }}>{c.code}</div>
                              <div style={{ fontSize: 10, color: "#8080aa", marginTop: 1 }}>{c.name}</div>
                            </div>

                            {/* Catalyst bar */}
                            <div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                                <span style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 12, color: catColor }}>{Math.round(cat)}</span>
                              </div>
                              <div style={{ height: 4, background: "#1a1a2e", borderRadius: 2, overflow: "hidden", width: "100%" }}>
                                <div style={{ width: `${cat}%`, height: "100%", background: catColor, borderRadius: 2, boxShadow: `0 0 6px ${catColor}` }} />
                              </div>
                            </div>

                            {/* Sentiment */}
                            <div>
                              <span style={{
                                fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                                color: sentColor, background: `${sentColor}18`,
                                border: `1px solid ${sentColor}33`,
                              }}>{sentLabel}</span>
                              <div style={{ fontSize: 10, color: sentColor, fontFamily: "'Space Mono', monospace", marginTop: 3 }}>
                                {sent === 0 ? "—" : `VSS: ${sent > 0 ? "+" : ""}${sent.toFixed(0)}`}
                              </div>
                            </div>

                            {/* Momentum */}
                            <div style={{ fontSize: 12, fontFamily: "'Space Mono', monospace", color: momColor, fontWeight: 700 }}>
                              {mom > 0 ? "+" : ""}{mom.toFixed(2)}%
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}

                {(() => {
                  const withScores = currencies.filter(c => c.catalyst_score != null);
                  if (withScores.length === 0) return (
                    <div style={{ textAlign: "center", padding: "40px 0", color: "#8080aa", fontSize: 13 }}>
                      Signal scores are computed on startup — check back in a moment.
                    </div>
                  );
                  const isSearching = signalSearch.trim().length > 0;
                  const matchCount = isSearching
                    ? withScores.filter(c =>
                        c.code.toLowerCase().includes(signalSearch.toLowerCase()) ||
                        c.name.toLowerCase().includes(signalSearch.toLowerCase())
                      ).length
                    : null;
                  if (isSearching && matchCount === 0) return (
                    <div style={{ textAlign: "center", padding: "24px 0", color: "#8080aa", fontSize: 13 }}>
                      No currencies match "{signalSearch}"
                    </div>
                  );
                  if (!isSearching) return (
                    <div style={{ textAlign: "center", padding: "14px 0", fontSize: 11, color: "#8080aa" }}>
                      Showing top 10 of {withScores.length} — search to find any currency
                    </div>
                  );
                  return null;
                })()}
              </div>
            </div>
          )}

          {activeTab === "about" && (() => {
            const sections = [
              {
                id: 0,
                color: "#ff4d4d",
                title: "What is a Hype Currency?",
                content: (
                  <div style={{ fontSize: 13, color: "#9999cc", lineHeight: 1.75 }}>
                    <p style={{ marginTop: 0 }}>A <span style={{ color: "#00d4aa", fontWeight: 600 }}>hype currency</span> is not a mainstream forex pair. It's a currency that attracts <em>retail speculative attention</em> for structural or narrative reasons — usually extreme undervaluation relative to a theoretical or historical benchmark, or proximity to some kind of catalyst event.</p>
                    <p>There are six recurring archetypes:</p>
                    <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                      <li><span style={{ color: "#e8e8ff", fontWeight: 600 }}>Revaluation plays</span> — currencies like <span style={{ color: "#00d4aa" }}>IQD</span> and <span style={{ color: "#00d4aa" }}>VND</span> where communities believe the government will reset the rate upward. The thesis is usually loosely grounded in post-war reconstruction or oil revenue. These are the most widely traded hype currencies.</li>
                      <li><span style={{ color: "#e8e8ff", fontWeight: 600 }}>Sanctions distortion</span> — <span style={{ color: "#00d4aa" }}>IRR</span>, <span style={{ color: "#00d4aa" }}>KPW</span>. Massive gap between official and black market rates. Speculators bet on eventual normalization.</li>
                      <li><span style={{ color: "#e8e8ff", fontWeight: 600 }}>Post-conflict reconstruction</span> — <span style={{ color: "#00d4aa" }}>SYP</span>, <span style={{ color: "#00d4aa" }}>AFN</span>. Theory: peace brings investment, investment brings demand, demand brings appreciation.</li>
                      <li><span style={{ color: "#e8e8ff", fontWeight: 600 }}>Hyperinflationary collapse</span> — <span style={{ color: "#00d4aa" }}>ZWL</span>, <span style={{ color: "#00d4aa" }}>VES</span>, <span style={{ color: "#00d4aa" }}>LBP</span>. The floor is effectively zero, so any stabilization looks like a massive gain in percentage terms.</li>
                      <li><span style={{ color: "#e8e8ff", fontWeight: 600 }}>IMF dependency / serial devaluation</span> — <span style={{ color: "#00d4aa" }}>ARS</span>, <span style={{ color: "#00d4aa" }}>EGP</span>, <span style={{ color: "#00d4aa" }}>PKR</span>. Reform narratives, IMF program compliance, and central bank credibility signals drive speculative cycles.</li>
                      <li><span style={{ color: "#e8e8ff", fontWeight: 600 }}>Commodity-backed reform narratives</span> — <span style={{ color: "#00d4aa" }}>CDF</span>, <span style={{ color: "#00d4aa" }}>NGN</span>. Natural resource wealth vs. governance failures. When reform language appears, speculators pile in.</li>
                    </ul>
                    <p style={{ marginBottom: 0 }}>Most retail speculators in these currencies are buying physical banknotes or digital transfers through informal channels, not spot FX. The actual thesis is simple: buy something priced near zero, hope it reprices. The realistic probability of that happening is low for most of these currencies — but the potential multiplier is what drives interest.</p>
                  </div>
                ),
              },
              {
                id: 1,
                color: "#ffa500",
                title: "Hype Score (0–100)",
                content: (
                  <div style={{ fontSize: 13, color: "#9999cc", lineHeight: 1.75 }}>
                    <p style={{ marginTop: 0 }}>The <span style={{ color: "#00d4aa", fontWeight: 600 }}>Hype Score</span> is a <em>backward-looking</em> composite — it measures how much noise is currently surrounding a currency, not whether that noise reflects real opportunity.</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "16px 0" }}>
                      {[
                        ["40%", "#ffa500", "News Volume", "Raw article count over the last 7 days. Normalised across all 40 currencies. A currency generating 50 articles scores much higher than one generating 2, regardless of what those articles say."],
                        ["30%", "#00d4aa", "Recency Weight", "Articles published within 48 hours count 3× more than older coverage. A currency that was big news last month but quiet today will score lower than one generating fresh headlines right now."],
                        ["20%", "#9999cc", "Rate Volatility", "Standard deviation of exchange rate snapshots over the last 24 hours. A moving rate signals something is happening — even sideways chop registers. Flat rates score near zero on this component."],
                        ["10%", "#5a5aaa", "Baseline Floor", "Structurally interesting currencies — sanctioned states, conflict zones, hyperinflationary economies — maintain a minimum score of 60 regardless of news cycle. All other currencies floor at 20. This prevents exotic currencies from disappearing from the radar during quiet periods."],
                      ].map(([pct, color, label, desc]) => (
                        <div key={label} style={{ display: "flex", gap: 12, padding: "12px 16px", background: "#070714", borderRadius: 10, border: "1px solid #1e1e3f" }}>
                          <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'Space Mono', monospace", color, minWidth: 44, paddingTop: 2 }}>{pct}</div>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#e8e8ff", marginBottom: 4 }}>{label}</div>
                            <div style={{ fontSize: 12, color: "#7a7aaa", lineHeight: 1.6 }}>{desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p style={{ fontSize: 12, color: "#8080aa", marginBottom: 0 }}>
                      <strong style={{ color: "#9999cc" }}>Scale:</strong>{" "}
                      <span style={{ color: "#8080aa" }}>0–30</span> quiet ·{" "}
                      <span style={{ color: "#00d4aa" }}>31–60</span> elevated ·{" "}
                      <span style={{ color: "#ffa500" }}>61–80</span> active ·{" "}
                      <span style={{ color: "#ff4d4d" }}>81–100</span> extreme
                    </p>
                  </div>
                ),
              },
              {
                id: 2,
                color: "#00b4ff",
                title: "Catalyst Score (0–100)",
                content: (
                  <div style={{ fontSize: 13, color: "#9999cc", lineHeight: 1.75 }}>
                    <p style={{ marginTop: 0 }}>The <span style={{ color: "#00b4ff", fontWeight: 600 }}>Catalyst Score</span> is <em>forward-looking</em> — it measures the quality and direction of signals, not just volume. While Hype measures noise, Catalyst measures signal.</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "16px 0" }}>
                      {[
                        ["60%", "#00b4ff", "News Sentiment", "Bullish-to-bearish keyword ratio across recent headlines. Bullish signals: revaluation language, IMF agreement, sanctions relief, ceasefire, central bank credibility, reform legislation. Bearish signals: hyperinflation, coup, civil war, sanctions, default, devaluation, embargo. Scored -100 to +100, normalised to 0–100."],
                        ["40%", "#7a6acd", "Rate Momentum", "Direction and magnitude of rate movement over the last 7 days of snapshots. A currency moving up consistently scores higher than one that spiked once and reversed. Flat movement scores near 50 (neutral)."],
                      ].map(([pct, color, label, desc]) => (
                        <div key={label} style={{ display: "flex", gap: 12, padding: "12px 16px", background: "#070714", borderRadius: 10, border: "1px solid #1e1e3f" }}>
                          <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'Space Mono', monospace", color, minWidth: 44, paddingTop: 2 }}>{pct}</div>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#e8e8ff", marginBottom: 4 }}>{label}</div>
                            <div style={{ fontSize: 12, color: "#7a7aaa", lineHeight: 1.6 }}>{desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ padding: "14px 16px", background: "#0a0a1f", borderRadius: 10, border: "1px solid #1e1e4f", marginBottom: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#e8e8ff", marginBottom: 8 }}>Hype vs. Catalyst — the key distinction</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ fontSize: 12, color: "#7a7aaa" }}>
                          <span style={{ color: "#ffa500", fontWeight: 600 }}>High Hype / Low Catalyst</span> — lots of talk, no movement. Classic IQD during quiet periods. The community is active but nothing is actually changing at the rate level or in the news sentiment. Usually a hold-and-wait situation.
                        </div>
                        <div style={{ fontSize: 12, color: "#7a7aaa" }}>
                          <span style={{ color: "#00b4ff", fontWeight: 600 }}>Low Hype / High Catalyst</span> — rate moving quietly with positive sentiment, but the broader community hasn't picked it up yet. Often the better setup, because by the time Hype catches up, you're already in.
                        </div>
                      </div>
                    </div>
                    <p style={{ marginBottom: 0, fontSize: 12, color: "#8080aa" }}>Catalyst Score updates every 12 hours alongside Hype Score. If the Claude API key is absent, sentiment scoring falls back to keyword-based analysis and Catalyst is weighted more heavily toward rate momentum.</p>
                  </div>
                ),
              },
              {
                id: 3,
                color: "#00d4aa",
                title: "ROI Calculator",
                content: (
                  <div style={{ fontSize: 13, color: "#9999cc", lineHeight: 1.75 }}>
                    <p style={{ marginTop: 0 }}>The ROI Calculator answers a simple question: <em>if this currency revalues to X, what are my holdings worth?</em></p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                      {[
                        ["Amount Held", "How many units you own. For IQD, realistic positions are in the millions — 1,000,000 IQD costs roughly $750 at current rates."],
                        ["Current Value", "Your holdings × current exchange rate. This is what your position is worth today in USD."],
                        ["Target Rate", "The USD rate you expect the currency to reach. For a revaluation play, this is usually 10–1000× the current rate. Enter it as a decimal — e.g., 0.001 for 1/10th of a cent."],
                        ["Target Value", "Your holdings × target rate. This is what your position would be worth if the revaluation happened."],
                        ["Multiplier", "Target Value ÷ Current Value. This is the number that matters, not the ROI %. A 100,000% ROI sounds dramatic but a 1000× multiplier is a cleaner way to think about the risk/reward."],
                      ].map(([label, desc]) => (
                        <div key={label} style={{ padding: "10px 14px", background: "#070714", borderRadius: 8, border: "1px solid #1e1e3f" }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "#00d4aa", marginBottom: 3 }}>{label}</div>
                          <div style={{ fontSize: 12, color: "#7a7aaa", lineHeight: 1.5 }}>{desc}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ padding: "14px 16px", background: "#0a1a14", borderRadius: 10, border: "1px solid #1a3a2a", marginBottom: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#00d4aa", marginBottom: 8 }}>Worked example — IQD revaluation scenario</div>
                      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: "#7a7aaa", lineHeight: 2 }}>
                        <div>Amount: <span style={{ color: "#e8e8ff" }}>20,000,000 IQD</span></div>
                        <div>Current rate: <span style={{ color: "#e8e8ff" }}>~0.00077 USD</span></div>
                        <div>Current value: <span style={{ color: "#00d4aa" }}>~$15,400</span></div>
                        <div>Target rate (1:1): <span style={{ color: "#ffa500" }}>1.00 USD</span></div>
                        <div>Target value: <span style={{ color: "#ffa500" }}>$20,000,000</span></div>
                        <div>Multiplier: <span style={{ color: "#ff4d4d" }}>~1,300×</span></div>
                      </div>
                      <div style={{ fontSize: 11, color: "#8080aa", marginTop: 8 }}>The 1:1 scenario is a community meme, not an analyst projection. No credible FX analysis supports it. But it illustrates why the multiplier matters more than the ROI %.</div>
                    </div>
                    <p style={{ marginBottom: 0, fontSize: 12, color: "#8080aa" }}>Use the Quick Scenarios panel to model 2×, 5×, 10×, 50×, and 100× revaluations instantly without entering a target rate manually.</p>
                  </div>
                ),
              },
              {
                id: 4,
                color: "#9999cc",
                title: "Data Sources & Limitations",
                content: (
                  <div style={{ fontSize: 13, color: "#9999cc", lineHeight: 1.75 }}>
                    <p style={{ marginTop: 0 }}>Transparency matters here. These are the actual data sources and their real constraints:</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                      {[
                        ["ExchangeRate-API", "#00d4aa", "Live market feed for ~30 of 40 tracked currencies. Updates every 15 minutes. Reliable for mainstream and semi-exotic currencies. Currencies with a LIVE badge use this feed."],
                        ["Analyst Fallback Rates", "#ffa500", "10 exotic and sanctioned currencies (IRR, KPW, ZWL, MMK, SYP, VES, LBP, SDG, YER, SOS) use analyst-maintained fallback rates. Reason: no reliable market feed exists. Black market rates, sanctions distortions, and dual exchange rate systems make any single 'live' rate misleading. EST badge = fallback rate. These rates are updated manually when significant changes are confirmed."],
                        ["News Pipeline", "#9999cc", "3-tier RSS architecture with no API key or rate limits. Tier 1 (3× weight): institutional feeds — IMF, World Bank, US Treasury OFAC, BIS. Tier 2 (2× weight): GDELT Project filtered to quality domains (Reuters, FT, Bloomberg, Al Jazeera, BBC, etc.). Tier 3 (1× weight): currency-specific regional sources (Iraq Business News, NK News, Caracas Chronicles, Nairametrics, etc.). Scores refresh every 12 hours — during fast-moving situations, check primary sources directly."],
                        ["Claude AI Sentiment", "#7b7bcc", "Headlines are scored by Claude (Haiku model) which understands financial and geopolitical context: 'sanctions relief' is bullish, 'IMF program suspended' is bearish, 'CBI reduces auction spread' is strongly bullish for IQD. Sentiment accounts for 60% of the Catalyst Score. Falls back to keyword scoring if no API key is present."],
                        ["Rate History", "#5a5aaa", "Snapshots stored every 15 minutes, retained for 7 days. Hype and Catalyst history retained for 30 days. The sparkline and trend indicators reflect this window."],
                      ].map(([label, color, desc]) => (
                        <div key={label} style={{ display: "flex", gap: 12, padding: "12px 16px", background: "#070714", borderRadius: 10, border: "1px solid #1e1e3f" }}>
                          <div style={{ width: 3, borderRadius: 2, background: color, flexShrink: 0 }} />
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 700, color, marginBottom: 4 }}>{label}</div>
                            <div style={{ fontSize: 12, color: "#7a7aaa", lineHeight: 1.6 }}>{desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div style={{ padding: "14px 16px", background: "#0a0a0a", borderRadius: 10, border: "1px solid #2a1a00", fontSize: 12, color: "#7a6a40", lineHeight: 1.6 }}>
                      <strong style={{ color: "#a08040" }}>Not financial advice.</strong> Project Hype is a research and analysis tool. Scores reflect news activity and rate signals — not fundamentals, not analyst consensus, not investment recommendations. Hype currencies carry extreme risk. Most revaluation scenarios discussed in speculative communities have no credible basis in monetary policy or macroeconomics. Do your own research before putting real money into any of these.
                    </div>
                  </div>
                ),
              },
            ];

            return (
              <div style={{ animation: "slideIn 0.3s ease", flex: 1, display: "flex", flexDirection: "column" }}>
                <div style={{
                  background: "linear-gradient(135deg, #0d0d1a 0%, #111128 100%)",
                  border: "1px solid #1e1e3f", borderRadius: 16, padding: isMobile ? 16 : 28, flex: 1
                }}>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: isMobile ? 16 : 20, letterSpacing: isMobile ? 0.5 : 1, marginBottom: 6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Info size={isMobile ? 16 : 20} /> About Project Hype</span>
                  </div>
                  <div style={{ fontSize: 13, color: "#8080aa", lineHeight: 1.6, marginBottom: 12 }}>
                    A field guide to speculative currency intelligence — what the scores mean, where the data comes from, and how to use the tools.
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 32 }}>
                    <span style={{ fontSize: 11, color: "#8888bb", background: "#0d0d1a", border: "1px solid #1e1e3f", borderRadius: 20, padding: "5px 14px" }}>
                      Currently tracking <strong style={{ color: "#c0c0e8" }}>{currencies.length}</strong> currencies across <strong style={{ color: "#c0c0e8" }}>6</strong> geopolitical regions
                    </span>
                    {(() => {
                      const lastScored = currencies.find(c => c.hype_score != null);
                      if (!lastScored) return null;
                      return (
                        <span style={{ fontSize: 11, color: "#8888bb", background: "#0d0d1a", border: "1px solid #1e1e3f", borderRadius: 20, padding: "5px 14px" }}>
                          Scores refresh every <strong style={{ color: "#c0c0e8" }}>12 hours</strong>
                        </span>
                      );
                    })()}
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    {sections.map(({ id, color, title, content }) => {
                      const isOpen = openAccordion === id;
                      return (
                        <div key={id} style={{
                          background: "#070714", borderRadius: 12,
                          borderTop: `1px solid ${isOpen ? color + "44" : "#1e1e3f"}`,
                          borderRight: `1px solid ${isOpen ? color + "44" : "#1e1e3f"}`,
                          borderBottom: `1px solid ${isOpen ? color + "44" : "#1e1e3f"}`,
                          borderLeft: `3px solid ${color}`,
                          overflow: "hidden", transition: "border-color 0.2s",
                        }}>
                          <button
                            onClick={() => setOpenAccordion(isOpen ? null : id)}
                            style={{
                              width: "100%", padding: "16px 20px", background: "none", border: "none",
                              cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center",
                              textAlign: "left",
                            }}
                          >
                            <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 15, color: isOpen ? "#e8e8ff" : "#9999cc", letterSpacing: 0.5 }}>
                              {title}
                            </div>
                            <div style={{
                              fontSize: 18, color, transition: "transform 0.25s",
                              transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", flexShrink: 0, marginLeft: 12,
                            }}>⌄</div>
                          </button>
                          {isOpen && (
                            <div style={{ padding: "0 20px 20px 20px", borderTop: `1px solid ${color}22` }}>
                              {content}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}

          </div>{/* end tab content wrapper */}

        </div>{/* end Left Column */}

        {/* Right Sidebar — Latest Intel (sticky) */}
        {!isNarrow && (
          <div style={{
            position: "sticky",
            top: 32,
            maxHeight: "calc(100vh - 64px)",
            display: "flex",
            flexDirection: "column",
          }}>
            <div style={{
              background: "linear-gradient(135deg, #0d0d1a 0%, #111128 100%)",
              border: "1px solid #1e1e3f", borderRadius: 16, padding: 24,
              display: "flex", flexDirection: "column",
              flex: 1, overflowY: "auto", scrollbarWidth: "thin",
            }}>

              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: 1, display: "flex", alignItems: "center", gap: 6 }}><Newspaper size={14} /> LATEST INTEL</div>
                {headlines.length > 0 && (
                  <div style={{
                    fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 10, letterSpacing: 1,
                    background: headlines[0]?.mock ? "#1a1a00" : "#003322",
                    color: headlines[0]?.mock ? "#ffa500" : "#00d4aa",
                    border: `1px solid ${headlines[0]?.mock ? "#ffa50033" : "#00d4aa33"}`,
                  }}>
                    {headlines[0]?.mock ? "ANALYST" : "LIVE"}
                  </div>
                )}
              </div>

              {/* ── Section: News ── */}
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#8080aa", textTransform: "uppercase", marginBottom: 10 }}>
                NEWS · {selected.code}
              </div>
              <div key={selected.code} style={{ maxHeight: 260, overflowY: "auto", scrollbarWidth: "thin" }}>
                {loadingNews ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 0" }}>
                    {[100, 80, 100, 60].map((w, i) => (
                      <div key={i} style={{
                        height: i % 2 === 0 ? 12 : 8, width: `${w}%`, borderRadius: 4,
                        background: "linear-gradient(90deg,#0d0d1a 0%,#1a1a2e 50%,#0d0d1a 100%)",
                        backgroundSize: "400px 100%", animation: `shimmer 1.5s ${i * 0.1}s infinite linear`,
                      }} />
                    ))}
                  </div>
                ) : headlines.length === 0 ? (
                  <div style={{ color: "#5c5c8a", fontSize: 12, textAlign: "center", padding: "16px 0" }}>No headlines available</div>
                ) : (
                  <div>
                    {headlines.map((h, i) => {
                      const border = i < headlines.length - 1 ? "1px solid #0f0f22" : "none";
                      const meta = (
                        <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 4, flexShrink: 0,
                            background: h.mock ? "#1a1a00" : "#1e1e3f",
                            color: h.mock ? "#ffa500" : "#5a5aaa", letterSpacing: 1,
                            maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>{h.mock ? "ANALYST" : h.source}</span>
                          {h.published_at && <span style={{ fontSize: 10, color: "#5c5c8a", whiteSpace: "nowrap" }}>{new Date(h.published_at).toLocaleDateString()}</span>}
                        </div>
                      );

                      if (h.url) {
                        return (
                          <a key={i} href={h.url} target="_blank" rel="noopener noreferrer"
                            style={{ display: "block", padding: "9px 0", borderBottom: border, textDecoration: "none", cursor: "pointer" }}
                            onMouseEnter={e => { e.currentTarget.querySelector(".hl-title").style.color = "#e8e8ff"; e.currentTarget.querySelector(".hl-arrow").style.opacity = "1"; e.currentTarget.style.background = "#0a0a18"; }}
                            onMouseLeave={e => { e.currentTarget.querySelector(".hl-title").style.color = "#9999cc"; e.currentTarget.querySelector(".hl-arrow").style.opacity = "0"; e.currentTarget.style.background = "transparent"; }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>{meta}</div>
                              <span className="hl-arrow" style={{ fontSize: 10, color: "#5a5aaa", opacity: 0, transition: "opacity 0.15s", flexShrink: 0, paddingTop: 2 }}>↗</span>
                            </div>
                            <div className="hl-title" style={{ fontSize: 12, color: "#9999cc", lineHeight: 1.4, textDecoration: "underline", textDecorationColor: "#2a2a4a", textUnderlineOffset: 3 }}>{h.title}</div>
                          </a>
                        );
                      }

                      // Mock/analyst headline — not clickable
                      return (
                        <div key={i} style={{ padding: "9px 0", borderBottom: border }}>
                          {meta}
                          <div style={{ fontSize: 12, color: "#6a6a8a", lineHeight: 1.4, fontStyle: "italic" }}>{h.title}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── Divider ── */}
              <div style={{ height: 1, background: "#1a1a33", margin: "18px 0" }} />

              {/* ── Section: Top Movers 24H ── */}
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#8080aa", textTransform: "uppercase", marginBottom: 12, display: "flex", alignItems: "center", gap: 5 }}>
                <BarChart2 size={12} /> TOP MOVERS · 24H
              </div>
              {(() => {
                const movers = [...currencies]
                  .filter(c => c.change_24h != null)
                  .sort((a, b) => Math.abs(b.change_24h) - Math.abs(a.change_24h))
                  .slice(0, 4);
                if (movers.length === 0) return (
                  <div style={{ fontSize: 11, color: "#5c5c8a", padding: "8px 0" }}>Rate history populating…</div>
                );
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 4 }}>
                    {movers.map(c => {
                      const pos = c.change_24h >= 0;
                      const color = pos ? "#00d4aa" : "#ff4d4d";
                      return (
                        <div
                          key={c.code}
                          onClick={() => { setSelected(c); setActiveTab("calculator"); }}
                          style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 8, background: "#070714", cursor: "pointer", transition: "background 0.15s" }}
                          onMouseEnter={e => e.currentTarget.style.background = "#111128"}
                          onMouseLeave={e => e.currentTarget.style.background = "#070714"}
                        >
                          <FlagIcon code={c.code} size={16} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#e8e8ff", fontFamily: "'Space Mono', monospace" }}>{c.code}</div>
                            <div style={{ fontSize: 10, color: "#8080aa" }}>{c.name}</div>
                          </div>
                          <div style={{
                            fontSize: 11, fontWeight: 700, fontFamily: "'Space Mono', monospace",
                            color, padding: "2px 7px", borderRadius: 4,
                            background: pos ? "#00d4aa11" : "#ff4d4d11",
                            border: `1px solid ${pos ? "#00d4aa33" : "#ff4d4d33"}`,
                          }}>
                            {pos ? "+" : ""}{c.change_24h.toFixed(2)}%
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* ── Divider ── */}
              <div style={{ height: 1, background: "#1a1a33", margin: "18px 0" }} />

              {/* ── Section: Top Signals ── */}
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#8080aa", textTransform: "uppercase", marginBottom: 12, display: "flex", alignItems: "center", gap: 5 }}>
                  <Zap size={12} /> TOP SIGNALS
                </div>
                {(() => {
                  const top = [...currencies]
                    .filter(c => c.catalyst_score != null)
                    .sort((a, b) => b.catalyst_score - a.catalyst_score)
                    .slice(0, 3);
                  if (top.length === 0) return (
                    <div style={{ fontSize: 11, color: "#5c5c8a", padding: "8px 0" }}>Scores computing on startup…</div>
                  );
                  return (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {top.map(c => {
                        const score = Math.round(c.catalyst_score);
                        const color = score >= 70 ? "#00d4aa" : score >= 45 ? "#ffa500" : "#5a5aaa";
                        return (
                          <div
                            key={c.code}
                            onClick={() => { setSelected(c); setActiveTab("calculator"); }}
                            style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderRadius: 8, background: "#070714", cursor: "pointer", transition: "background 0.15s" }}
                            onMouseEnter={e => e.currentTarget.style.background = "#111128"}
                            onMouseLeave={e => e.currentTarget.style.background = "#070714"}
                          >
                            <FlagIcon code={c.code} size={16} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: "#e8e8ff", fontFamily: "'Space Mono', monospace" }}>{c.code}</div>
                              <div style={{ fontSize: 10, color: "#8080aa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                              <div style={{ width: 40, height: 4, background: "#1a1a2e", borderRadius: 2, overflow: "hidden" }}>
                                <div style={{ width: `${score}%`, height: "100%", background: color, borderRadius: 2, boxShadow: `0 0 4px ${color}` }} />
                              </div>
                              <span style={{ fontSize: 11, fontWeight: 700, color, fontFamily: "'Space Mono', monospace", minWidth: 22, textAlign: "right" }}>{score}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>{/* end Top Signals */}

              {/* ── Divider ── */}
              <div style={{ height: 1, background: "#1a1a33", margin: "18px 0" }} />

              {/* ── Section: Institutional Signals ── */}
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "#8080aa", textTransform: "uppercase", marginBottom: 12, display: "flex", alignItems: "center", gap: 5 }}>
                  <AlertTriangle size={12} /> INSTITUTIONAL SIGNALS
                </div>
                {loadingSignals ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {[1, 2].map(i => (
                      <div key={i} style={{ height: 10, width: "100%", borderRadius: 4, background: "linear-gradient(90deg,#0d0d1a 0%,#1a1a2e 50%,#0d0d1a 100%)", backgroundSize: "400px 100%", animation: "shimmer 1.5s infinite linear" }} />
                    ))}
                  </div>
                ) : institutionalSignals.length === 0 ? (
                  <div style={{ fontSize: 11, color: "#5c5c8a", padding: "4px 0" }}>No active institutional signals</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {institutionalSignals.map(sig => {
                      const isPositive = sig.signal_type === "IMF_POSITIVE" || sig.signal_type === "SANCTIONS_RELIEF";
                      const color = isPositive ? "#00d4aa" : "#ff4d4d";
                      const bg = isPositive ? "#00d4aa11" : "#ff4d4d11";
                      const border = isPositive ? "#00d4aa33" : "#ff4d4d33";
                      const label = {
                        IMF_POSITIVE: "IMF POSITIVE",
                        IMF_NEGATIVE: "IMF NEGATIVE",
                        SANCTIONS_RELIEF: "SANCTIONS RELIEF",
                        SANCTIONS_ADDED: "SANCTIONS ADDED",
                      }[sig.signal_type] || sig.signal_type;
                      return (
                        <div key={sig.id} style={{ padding: "8px 10px", borderRadius: 8, background: bg, border: `1px solid ${border}` }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                            <span style={{ fontSize: 9, fontWeight: 700, color, letterSpacing: 1 }}>{label}</span>
                            {sig.published_at && (
                              <span style={{ fontSize: 9, color: "#5c5c8a" }}>
                                {new Date(sig.published_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                              </span>
                            )}
                          </div>
                          {sig.url ? (
                            <a href={sig.url} target="_blank" rel="noopener noreferrer"
                              style={{ fontSize: 11, color: "#9999cc", textDecoration: "none", lineHeight: 1.4, display: "block" }}
                              onMouseEnter={e => e.currentTarget.style.color = "#e8e8ff"}
                              onMouseLeave={e => e.currentTarget.style.color = "#9999cc"}>
                              {sig.headline.length > 90 ? sig.headline.slice(0, 87) + "…" : sig.headline}
                            </a>
                          ) : (
                            <div style={{ fontSize: 11, color: "#8080aa", lineHeight: 1.4 }}>
                              {sig.headline.length > 90 ? sig.headline.slice(0, 87) + "…" : sig.headline}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>{/* end Institutional Signals */}

            </div>{/* end sidebar inner */}
          </div>
        )}{/* end sticky sidebar */}

        </div>{/* end inner grid: tab content + sidebar */}

        {/* Bottom panels — full width, outside sidebar sticky scope */}
        <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "1fr 1fr 1fr", gap: 24 }}>

          {/* Top Hype / Catalyst Toggle */}
          <div style={{ background: "linear-gradient(135deg, #0d0d1a 0%, #111128 100%)", border: "1px solid #1e1e3f", borderRadius: 16, padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ display: "flex", gap: 4, background: "#070714", borderRadius: 8, padding: 3 }}>
                <button onClick={() => setBottomView("hype")} style={{
                  padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer",
                  background: bottomView === "hype" ? "linear-gradient(135deg, #1e1e4f, #252560)" : "transparent",
                  color: bottomView === "hype" ? "#ffa500" : "#8080aa", fontSize: 12, fontWeight: 700, transition: "all 0.2s"
                }}><Flame size={12} style={{ verticalAlign: "middle" }} /> TOP HYPE</button>
                <button onClick={() => setBottomView("catalyst")} style={{
                  padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer",
                  background: bottomView === "catalyst" ? "linear-gradient(135deg, #0d1a2e, #0d2040)" : "transparent",
                  color: bottomView === "catalyst" ? "#00b4ff" : "#8080aa", fontSize: 12, fontWeight: 700, transition: "all 0.2s"
                }}><Zap size={12} style={{ verticalAlign: "middle" }} /> TOP CATALYST</button>
              </div>
            </div>
            {bottomView === "hype" ? topHype.map((c, i) => (
              <div key={c.code} onClick={() => { setSelected(c); setActiveTab("calculator"); }}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: i < topHype.length - 1 ? "1px solid #0f0f22" : "none", cursor: "pointer", transition: "all 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.opacity = "0.7"}
                onMouseLeave={e => e.currentTarget.style.opacity = "1"}
              >
                <div style={{ color: "#5c5c8a", fontFamily: "'Space Mono', monospace", fontSize: 11, minWidth: 16 }}>#{i + 1}</div>
                <FlagIcon code={c.code} size={22} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#e8e8ff" }}>{c.code}</div>
                  <div style={{ fontSize: 11, color: "#8080aa" }}>{c.name}</div>
                </div>
                <div><HypeBar score={Math.round(c.hype_score ?? c.hype)} /></div>
              </div>
            )) : topCatalyst.slice(0, 6).map((c, i) => (
              <div key={c.code} onClick={() => { setSelected(c); setActiveTab("calculator"); }}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: i < Math.min(topCatalyst.length, 6) - 1 ? "1px solid #0f0f22" : "none", cursor: "pointer", transition: "all 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.opacity = "0.7"}
                onMouseLeave={e => e.currentTarget.style.opacity = "1"}
              >
                <div style={{ color: "#5c5c8a", fontFamily: "'Space Mono', monospace", fontSize: 11, minWidth: 16 }}>#{i + 1}</div>
                <FlagIcon code={c.code} size={22} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#e8e8ff" }}>{c.code}</div>
                  <div style={{ fontSize: 11, color: "#8080aa" }}>{c.name}</div>
                </div>
                <div><CatalystBar score={Math.round(c.catalyst_score)} /></div>
              </div>
            ))}
          </div>

          {/* Quick Scenarios */}
          <div style={{ background: "linear-gradient(135deg, #0d0d1a 0%, #111128 100%)", border: "1px solid #1e1e3f", borderRadius: 16, padding: 24 }}>
            <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: 1, marginBottom: 16, display: "flex", alignItems: "center", gap: 6 }}><Zap size={14} /> QUICK SCENARIOS</div>
            <div style={{ fontSize: 12, color: "#8080aa", marginBottom: 14 }}>{selected.code} · {parseFloat(amount || 0).toLocaleString()} units</div>
            {[2, 5, 10, 50, 100].map(mult => {
              const tgt = selected.rate * mult;
              const val = parseFloat(amount || 0) * tgt;
              const gain = val - parseFloat(amount || 0) * selected.rate;
              return (
                <div key={mult} onClick={() => { setTargetRate(tgt.toFixed(10)); setActiveTab("calculator"); trackEvent("scenario_clicked", { multiplier: mult, code: selected.code }); }}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderRadius: 8, marginBottom: 6, background: "#070714", border: "1px solid #1e1e3f", cursor: "pointer", transition: "all 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "#ffa500"; e.currentTarget.style.background = "#111128"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "#1e1e3f"; e.currentTarget.style.background = "#070714"; }}
                >
                  <div>
                    <span style={{ color: "#ffa500", fontWeight: 700, fontSize: 13 }}>{mult}x</span>
                    <span style={{ color: "#8080aa", fontSize: 11, marginLeft: 8 }}>revaluation</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#00d4aa", fontFamily: "'Space Mono', monospace" }}>{fmt(val)}</div>
                    <div style={{ fontSize: 10, color: "#8080aa" }}>+{fmt(gain)}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Rate History */}
          <div style={{ background: "linear-gradient(135deg, #0d0d1a 0%, #111128 100%)", border: "1px solid #1e1e3f", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: 1, display: "flex", alignItems: "center", gap: 6 }}><TrendingUp size={14} /> RATE HISTORY</div>
              <div style={{ fontSize: 11, color: "#8080aa" }}>{selected.code} · {rateHistory.length} pts</div>
            </div>
            <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
              {["1H", "6H", "24H", "7D"].map(w => (
                <button key={w} onClick={() => setHistoryWindow(w)} style={{
                  flex: 1, padding: "4px 0", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                  background: historyWindow === w ? "#1e1e4f" : "#070714",
                  color: historyWindow === w ? "#9999cc" : "#5c5c8a",
                  transition: "all 0.15s",
                }}>{w}</button>
              ))}
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              {rateHistory.length >= 2 ? (() => {
                const sparkColor = selected.change_24h == null ? "#8080aa" : selected.change_24h >= 0 ? "#00d4aa" : "#ff4d4d";
                const pts = [...rateHistory].reverse();
                const fmtTime = (ts) => {
                  if (!ts) return "";
                  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
                };
                const midPt = pts[Math.floor(pts.length / 2)];
                return (
                  <>
                    <div style={{ width: "100%" }}>
                      <Sparkline data={rateHistory} color={sparkColor} height={100} />
                    </div>
                    {/* Rate labels */}
                    <div style={{ display: "flex", justifyContent: "space-between", width: "100%", marginTop: 8 }}>
                      <div style={{ fontSize: 10, color: "#8080aa", fontFamily: "'Space Mono', monospace" }}>{pts[0]?.rate.toFixed(8)}</div>
                      <div style={{ fontSize: 10, fontFamily: "'Space Mono', monospace", color: sparkColor, fontWeight: 700 }}>{pts[pts.length - 1]?.rate.toFixed(8)}</div>
                    </div>
                    {/* Timeline */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", marginTop: 4 }}>
                      <div style={{ fontSize: 9, color: "#4a4a6a", fontFamily: "'Space Mono', monospace" }}>{fmtTime(pts[0]?.timestamp)}</div>
                      {midPt && <div style={{ fontSize: 9, color: "#4a4a6a", fontFamily: "'Space Mono', monospace" }}>{fmtTime(midPt.timestamp)}</div>}
                      <div style={{ fontSize: 9, color: "#4a4a6a", fontFamily: "'Space Mono', monospace" }}>now</div>
                    </div>
                  </>
                );
              })() : (
                <div style={{ width: "100%", textAlign: "center" }}>
                  <div style={{
                    height: 6, borderRadius: 3, marginBottom: 12,
                    background: "linear-gradient(90deg, #0d0d1a 0%, #1a1a2e 50%, #0d0d1a 100%)",
                    backgroundSize: "400px 100%", animation: "shimmer 2s infinite linear, gradpulse 2s infinite",
                  }} />
                  <div style={{ fontSize: 11, color: "#5c5c8a" }}>Accumulating data — updates every 5 min</div>
                </div>
              )}
            </div>
          </div>

        </div>{/* end bottom panels */}

      </div>{/* end main layout */}

      {/* ── Disclaimer modal (shown on first visit) ──────────────────────────── */}
      {disclaimerOpen && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 2000,
          background: "rgba(0,0,0,0.88)", display: "flex",
          alignItems: "center", justifyContent: "center", padding: 24,
        }}>
          <div style={{
            background: "#0d0d1a", border: "1px solid #3a2200",
            borderRadius: 16, maxWidth: 560, width: "100%",
            padding: isMobile ? "28px 20px" : "40px 44px",
            boxShadow: "0 0 60px #ff430022",
          }}>
            {/* Icon + title */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 12,
                background: "linear-gradient(135deg, #ff4d4d, #ff8c00)",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <AlertTriangle size={24} color="#fff" />
              </div>
              <div>
                <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 800, color: "#fff", letterSpacing: 1 }}>
                  Before You Continue
                </div>
                <div style={{ fontSize: 12, color: "#8080aa", marginTop: 2 }}>Please read this carefully</div>
              </div>
            </div>

            {/* Body */}
            <div style={{ fontSize: 14, color: "#c0c0e0", lineHeight: 1.75 }}>
              <p style={{ margin: "0 0 14px" }}>
                <strong style={{ color: "#ffa500" }}>Project Hype is a speculative research and entertainment tool.</strong>{" "}
                It uses automated signals — news sentiment, short-term rate momentum, and commodity price changes — to generate scores for exotic and frontier currencies.
              </p>
              <p style={{ margin: "0 0 14px" }}>
                <strong style={{ color: "#ff4d4d", fontSize: 15 }}>This is NOT financial advice.</strong>{" "}
                Nothing on this platform constitutes a recommendation to buy, sell, hold, or trade any currency, asset, or financial instrument.
              </p>
              <p style={{ margin: "0 0 14px" }}>
                Scores and data may be <strong style={{ color: "#ffa500" }}>inaccurate, incomplete, or significantly delayed.</strong>{" "}
                Speculative currencies carry <strong style={{ color: "#ffa500" }}>extreme risk</strong> — you can lose everything. Many of the currencies tracked are subject to capital controls, sanctions, or severe illiquidity.
              </p>
              <p style={{ margin: 0, color: "#8080aa", fontSize: 12 }}>
                Always consult a licensed financial advisor before making any investment decision. By continuing, you confirm you understand this tool is for research and entertainment purposes only.
              </p>
            </div>

            {/* CTA */}
            <button
              onClick={dismissDisclaimer}
              style={{
                marginTop: 28, width: "100%", padding: "14px 24px",
                background: "linear-gradient(135deg, #ff4d4d, #ff8c00)",
                border: "none", borderRadius: 10, color: "#fff",
                fontSize: 15, fontWeight: 700, cursor: "pointer",
                fontFamily: "'Syne',sans-serif", letterSpacing: 1,
              }}
            >
              I Understand — Continue to Project Hype
            </button>
          </div>
        </div>
      )}

      {/* How to Buy modal */}
      {buyModal && (() => {
        const info = HOW_TO_BUY[buyModal.code];
        const tierColor = { exchange: "#00d4aa", limited: "#ffa500", dealer: "#7a6acd", sanctioned: "#ff4d4d" };
        const tierLabel = { exchange: "Available on exchanges", limited: "Limited / P2P only", dealer: "Physical dealers only", sanctioned: "Sanctioned — do not buy" };
        return (
          <div
            onClick={() => setBuyModal(null)}
            style={{
              position: "fixed", inset: 0, background: "rgba(7,7,20,0.88)",
              display: "flex", alignItems: "center", justifyContent: "center",
              zIndex: 1000, padding: 24,
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background: "linear-gradient(135deg, #0d0d1a, #111128)",
                border: "1px solid #1e1e3f", borderRadius: 20, padding: 32,
                width: "100%", maxWidth: 520, animation: "slideIn 0.2s ease",
                maxHeight: "90vh", overflowY: "auto",
              }}
            >
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                <FlagIcon code={buyModal.code} size={28} />
                <div>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 20 }}>
                    How to Buy {buyModal.code}
                  </div>
                  <div style={{ fontSize: 12, color: "#8080aa" }}>{buyModal.name}</div>
                </div>
              </div>

              {!info ? (
                <div style={{ fontSize: 13, color: "#8080aa" }}>No buying guide available for this currency yet.</div>
              ) : (
                <>
                  {/* Tier badge */}
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    background: `${tierColor[info.tier]}15`, border: `1px solid ${tierColor[info.tier]}40`,
                    borderRadius: 8, padding: "4px 12px", marginBottom: 16,
                  }}>
                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: tierColor[info.tier] }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: tierColor[info.tier], letterSpacing: 1 }}>
                      {tierLabel[info.tier]}
                    </span>
                  </div>

                  {/* Summary */}
                  <p style={{ fontSize: 13, color: "#c8c8ee", lineHeight: 1.6, marginBottom: 20 }}>{info.summary}</p>

                  {/* Steps */}
                  {info.steps.length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 11, color: "#8080aa", letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>Steps</div>
                      {info.steps.map((step, i) => (
                        <div key={i} style={{ display: "flex", gap: 12, marginBottom: 10 }}>
                          <div style={{
                            flexShrink: 0, width: 22, height: 22, borderRadius: "50%",
                            background: "#1a1a3a", border: "1px solid #2a2a5a",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 11, fontWeight: 700, color: "#00d4aa", fontFamily: "'Space Mono', monospace",
                          }}>{i + 1}</div>
                          <div style={{ fontSize: 13, color: "#c8c8ee", lineHeight: 1.5, paddingTop: 2 }}>{step}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Platforms */}
                  {info.platforms.length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 11, color: "#8080aa", letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>Platforms</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {info.platforms.map(p => (
                          <a
                            key={p.name}
                            href={p.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 6,
                              background: "#111128", border: "1px solid #2a2a5a",
                              borderRadius: 8, padding: "6px 14px",
                              fontSize: 13, fontWeight: 600, color: "#00b4ff",
                              textDecoration: "none", transition: "all 0.15s",
                            }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = "#00b4ff"; e.currentTarget.style.background = "#0d1a2a"; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = "#2a2a5a"; e.currentTarget.style.background = "#111128"; }}
                          >
                            {p.name} ↗
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Disclaimer */}
                  {info.disclaimer && (
                    <div style={{
                      background: "#1a0a0a", border: "1px solid #3a1515",
                      borderRadius: 10, padding: "12px 14px", marginBottom: 20,
                    }}>
                      <div style={{ fontSize: 11, color: "#ff4d4d", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>Important</div>
                      <div style={{ fontSize: 12, color: "#cc8888", lineHeight: 1.5 }}>{info.disclaimer}</div>
                    </div>
                  )}
                </>
              )}

              <div style={{ fontSize: 11, color: "#4a4a6a", marginBottom: 16, lineHeight: 1.5 }}>
                Project Hype does not provide financial or legal advice. Always do your own research before transacting in any currency.
              </div>

              <button
                onClick={() => setBuyModal(null)}
                style={{
                  width: "100%", padding: 10, borderRadius: 8, border: "1px solid #1e1e3f",
                  background: "transparent", color: "#8080aa", fontSize: 13, cursor: "pointer",
                }}
              >Close</button>
            </div>
          </div>
        );
      })()}

      {/* Share Portfolio modal */}
      {shareModal && (
        <div
          onClick={() => setShareModal(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(7,7,20,0.85)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000, padding: 24,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "linear-gradient(135deg, #0d0d1a, #111128)",
              border: "1px solid #1e1e3f", borderRadius: 20, padding: 32,
              width: "100%", maxWidth: 480, animation: "slideIn 0.2s ease",
            }}
          >
            <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 18, marginBottom: 8 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Link2 size={18} /> Share Portfolio</span>
            </div>
            <div style={{ fontSize: 12, color: "#8080aa", marginBottom: 20 }}>
              Anyone with this link can view your current positions.
            </div>
            <div style={{
              display: "flex", gap: 8, alignItems: "stretch",
              background: "#070714", borderRadius: 10, border: "1px solid #1e1e3f",
              padding: "10px 14px", marginBottom: 20,
            }}>
              <div style={{
                flex: 1, fontSize: 12, color: "#9999cc", fontFamily: "'Space Mono', monospace",
                wordBreak: "break-all", lineHeight: 1.5,
              }}>
                {shareUrl}
              </div>
              <button
                onClick={() => { navigator.clipboard.writeText(shareUrl); setShareCopied(true); }}
                style={{
                  flexShrink: 0, padding: "6px 14px", borderRadius: 8, border: "none",
                  cursor: "pointer", fontSize: 12, fontWeight: 700, letterSpacing: 1,
                  background: shareCopied ? "#003322" : "linear-gradient(135deg, #1e1e4f, #252560)",
                  color: shareCopied ? "#00d4aa" : "#e8e8ff",
                  transition: "all 0.2s",
                }}
              >
                {shareCopied ? <><Check size={12} /> COPIED</> : "COPY"}
              </button>
            </div>
            <button
              onClick={() => setShareModal(false)}
              style={{
                width: "100%", padding: "10px", borderRadius: 8, border: "1px solid #1e1e3f",
                background: "transparent", color: "#8080aa", fontSize: 13, cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Alert / Subscribe modal */}
      {alertModal && (
        <div
          onClick={() => setAlertModal(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(7,7,20,0.88)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 1000, padding: 24,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "linear-gradient(135deg, #0d0d1a, #111128)",
              border: "1px solid #1e1e3f", borderRadius: 20, padding: 32,
              width: "100%", maxWidth: 520, animation: "slideIn 0.2s ease",
              maxHeight: "90vh", overflowY: "auto",
            }}
          >
            {alertSubmitted ? (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{ marginBottom: 16 }}><CheckCircle2 size={40} color="#00d4aa" /></div>
                <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 18, marginBottom: 8 }}>
                  You're subscribed
                </div>
                <div style={{ fontSize: 13, color: "#8080aa", lineHeight: 1.6, marginBottom: 16 }}>
                  We'll email you when any tracked currency's Catalyst Score jumps 15+ points.
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", marginBottom: 20 }}>
                  {[...alertCodes].map(code => {
                    const cur = currencies.find(c => c.code === code);
                    return (
                      <span key={code} style={{ fontSize: 12, padding: "3px 10px", borderRadius: 12, background: "#1e1e3f", color: "#9999cc", display: "inline-flex", alignItems: "center", gap: 4 }}>
                        {cur && <FlagIcon code={code} size={14} />} {code}
                      </span>
                    );
                  })}
                </div>
                <div style={{ fontSize: 11, color: "#8080aa" }}>Unsubscribe anytime from the email.</div>
                <button onClick={() => setAlertModal(false)} style={{
                  marginTop: 20, padding: "10px 28px", borderRadius: 8, border: "1px solid #1e1e3f",
                  background: "transparent", color: "#8080aa", fontSize: 13, cursor: "pointer",
                }}>Close</button>
              </div>
            ) : (
              <>
                <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 18, marginBottom: 6 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Bell size={18} /> Catalyst Score Alerts</span>
                </div>
                <div style={{ fontSize: 12, color: "#8080aa", lineHeight: 1.6, marginBottom: 20 }}>
                  We'll email you when any tracked currency's Catalyst Score jumps <strong style={{ color: "#00b4ff" }}>15+ points</strong> between scoring runs. Unsubscribe anytime.
                </div>

                {/* Email input */}
                <label style={{ fontSize: 11, color: "#8080aa", letterSpacing: 2, textTransform: "uppercase", display: "block", marginBottom: 8 }}>
                  Email
                </label>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={alertEmail}
                  onChange={e => setAlertEmail(e.target.value)}
                  style={{
                    width: "100%", padding: "11px 14px", boxSizing: "border-box",
                    background: "#070714", border: "1px solid #1e1e3f",
                    borderRadius: 8, color: "#e8e8ff", fontSize: 14, marginBottom: 20,
                  }}
                />

                {/* Currency checkboxes */}
                <label style={{ fontSize: 11, color: "#8080aa", letterSpacing: 2, textTransform: "uppercase", display: "block", marginBottom: 10 }}>
                  Track these currencies
                </label>
                <div style={{
                  maxHeight: 240, overflowY: "auto", background: "#070714",
                  border: "1px solid #1e1e3f", borderRadius: 10, padding: 8, marginBottom: 20,
                }}>
                  {currencies.map(c => {
                    const checked = alertCodes.has(c.code);
                    return (
                      <label key={c.code} style={{
                        display: "flex", alignItems: "center", gap: 10, padding: "7px 10px",
                        borderRadius: 7, cursor: "pointer", transition: "background 0.1s",
                        background: checked ? "#111128" : "transparent",
                      }}
                        onMouseEnter={e => e.currentTarget.style.background = "#0f0f24"}
                        onMouseLeave={e => e.currentTarget.style.background = checked ? "#111128" : "transparent"}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setAlertCodes(prev => {
                              const next = new Set(prev);
                              next.has(c.code) ? next.delete(c.code) : next.add(c.code);
                              return next;
                            });
                          }}
                          style={{ accentColor: "#00b4ff", width: 14, height: 14, flexShrink: 0 }}
                        />
                        <FlagIcon code={c.code} size={16} />
                        <span style={{ fontFamily: "'Space Mono',monospace", fontWeight: 700, fontSize: 12, color: "#00d4aa" }}>{c.code}</span>
                        <span style={{ fontSize: 12, color: "#8080aa" }}>{c.name}</span>
                        {c.catalyst_score != null && (
                          <span style={{ marginLeft: "auto", fontSize: 11, color: catalystColor(c.catalyst_score), fontFamily: "'Space Mono',monospace" }}>
                            {Math.round(c.catalyst_score)}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>

                {alertError && (
                  <div style={{ padding: "9px 14px", background: "#1a0d0d", border: "1px solid #ff4d4d33", borderRadius: 8, color: "#ff8a8a", fontSize: 12, marginBottom: 16 }}>
                    {alertError}
                  </div>
                )}

                <button
                  disabled={alertLoading}
                  onClick={async () => {
                    const email = alertEmail.trim();
                    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
                      setAlertError("Please enter a valid email address.");
                      return;
                    }
                    if (alertCodes.size === 0) {
                      setAlertError("Select at least one currency to track.");
                      return;
                    }
                    setAlertError("");
                    setAlertLoading(true);
                    try {
                      const res = await fetch(`${API}/api/alerts/subscribe`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ email, codes: [...alertCodes] }),
                      });
                      if (!res.ok) {
                        const d = await res.json().catch(() => ({}));
                        setAlertError(d.detail || "Subscription failed — please try again.");
                      } else {
                        setAlertSubmitted(true);
                        trackEvent("alert_subscribed", { currency_count: alertCodes.size });
                      }
                    } catch {
                      setAlertError("Network error — please check your connection.");
                    } finally {
                      setAlertLoading(false);
                    }
                  }}
                  style={{
                    width: "100%", padding: "13px", borderRadius: 10, border: "1px solid #00b4ff33", cursor: alertLoading ? "default" : "pointer",
                    background: alertLoading ? "#1a1a3a" : "linear-gradient(135deg, #0d1a2e, #0d2040)",
                    color: alertLoading ? "#8080aa" : "#00b4ff", fontSize: 13, fontWeight: 700,
                    letterSpacing: 1, transition: "opacity 0.15s",
                    opacity: alertLoading ? 0.7 : 1, marginBottom: 12,
                  }}
                >
                  {alertLoading ? "Subscribing…" : <><Bell size={16} style={{ verticalAlign: "middle" }} /> Notify me when Catalyst Score spikes</>}
                </button>

                <button onClick={() => setAlertModal(false)} style={{
                  width: "100%", padding: "10px", borderRadius: 8, border: "1px solid #1e1e3f",
                  background: "transparent", color: "#8080aa", fontSize: 13, cursor: "pointer",
                }}>Cancel</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
