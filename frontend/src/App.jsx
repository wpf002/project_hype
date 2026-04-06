import { useState, useEffect, useRef } from "react";

// In development: VITE_API_URL=http://localhost:8000 (or unset → fallback)
// In docker-compose: VITE_API_URL="" → relative /api/* URLs, proxied by nginx
// In Railway production: VITE_API_URL=https://your-backend.up.railway.app
const API = `${import.meta.env.VITE_API_URL ?? "http://localhost:8000"}/api`;

const HYPE_COLORS = {
  high: "#ff4d4d",
  mid: "#ffa500",
  low: "#00d4aa",
};

function HypeBar({ score }) {
  const color = score >= 80 ? HYPE_COLORS.high : score >= 55 ? HYPE_COLORS.mid : HYPE_COLORS.low;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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

function StatCard({ label, value, sub }) {
  return (
    <div style={{
      background: "linear-gradient(135deg, #0d0d1a 0%, #111128 100%)",
      border: "1px solid #1e1e3f", borderRadius: 12, padding: "18px 20px", flex: 1,
    }}>
      <div style={{ color: "#5a5a8a", fontSize: 11, textTransform: "uppercase", letterSpacing: 2, marginBottom: 6 }}>{label}</div>
      <div style={{ color: "#e8e8ff", fontSize: 22, fontWeight: 700, fontFamily: "'Space Mono', monospace" }}>{value}</div>
      {sub && <div style={{ color: "#5a5a8a", fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function LiveDot() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{
        display: "inline-block", width: 8, height: 8, borderRadius: "50%",
        background: "#00d4aa", boxShadow: "0 0 8px #00d4aa", animation: "pulse 2s infinite"
      }} />
      <span style={{ color: "#00d4aa", fontSize: 12, letterSpacing: 1 }}>LIVE</span>
    </span>
  );
}

// Small % change indicator — green positive, red negative, grey no data
function ChangeChip({ value }) {
  if (value === null || value === undefined) {
    return <span style={{ fontSize: 10, color: "#3a3a5a", fontFamily: "'Space Mono', monospace" }}>—</span>;
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

// Small badge shown next to exchange rates — distinguishes live API data from fallback estimates
function RateBadge({ live }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, letterSpacing: 1,
      background: live ? "#003322" : "#1a1a00",
      color: live ? "#00d4aa" : "#ffa500",
      border: `1px solid ${live ? "#00d4aa33" : "#ffa50033"}`,
      marginLeft: 8, verticalAlign: "middle",
    }}>
      {live ? "LIVE" : "EST"}
    </span>
  );
}

// Hype trend arrow — compares latest score vs ~6 snapshots ago (≈6h at hourly cadence)
function HypeTrend({ history }) {
  if (!history || history.length < 2) return null;
  const latest = history[0].score;
  const older = history[Math.min(5, history.length - 1)].score;
  const delta = latest - older;
  if (delta > 1) return <span style={{ color: "#00d4aa", fontWeight: 700, fontSize: 13 }}>↑</span>;
  if (delta < -1) return <span style={{ color: "#ff4d4d", fontWeight: 700, fontSize: 13 }}>↓</span>;
  return <span style={{ color: "#5a5a8a", fontWeight: 700, fontSize: 13 }}>→</span>;
}

function Sparkline({ data, color = "#00d4aa", height = 48 }) {
  // W/H are the fixed internal coordinate space — always numeric.
  // The `height` prop only sets the CSS height so it can be "100%" or a number.
  const W = 300, H = 100;

  if (!data || data.length < 2) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 11, color: "#2a2a4a" }}>Collecting data…</span>
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

export default function ProjectHype() {
  const [currencies, setCurrencies] = useState([]);
  const [loadingRates, setLoadingRates] = useState(true);
  const [selected, setSelected] = useState(null);
  const [amount, setAmount] = useState("20000000");
  const [targetRate, setTargetRate] = useState("");
  const [results, setResults] = useState(null);
  const [activeTab, setActiveTab] = useState("calculator");
  const [search, setSearch] = useState("");
  const [ticker, setTicker] = useState(0);
  const [headlines, setHeadlines] = useState([]);
  const [loadingNews, setLoadingNews] = useState(false);
  const [rateHistory, setRateHistory] = useState([]);
  const [hypeHistory, setHypeHistory] = useState([]);

  // ── Portfolio ─────────────────────────────────────────────────────────────
  const [portfolio, setPortfolio] = useState(() => {
    try { return JSON.parse(localStorage.getItem("hype_portfolio") || "[]"); }
    catch { return []; }
  });
  const [pfCode, setPfCode] = useState("");
  const [pfAmount, setPfAmount] = useState("");
  const [pfSearch, setPfSearch] = useState("");

  // ── Share modal ───────────────────────────────────────────────────────────
  const [shareModal, setShareModal] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [shareCopied, setShareCopied] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);

  // ── Shared-view banner (loaded from ?portfolio= URL param) ────────────────
  const [isSharedView, setIsSharedView] = useState(false);

  // Ref to cancel in-flight ROI requests when inputs change quickly
  const roiAbortRef = useRef(null);

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
    setPfAmount("");
  }

  function removePosition(code) {
    setPortfolio(prev => prev.filter(p => p.code !== code));
  }

  // ── Fetch all 40 currencies with live rates on mount ──────────────────────
  useEffect(() => {
    fetch(`${API}/rates`)
      .then(r => r.json())
      .then(data => {
        setCurrencies(data);
        setSelected(data[0]);
        setLoadingRates(false);
      })
      .catch(() => setLoadingRates(false));
  }, []);

  // ── Load shared portfolio from ?portfolio= URL param ──────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shareId = params.get("portfolio");
    if (!shareId) return;
    fetch(`${API}/portfolio/${shareId}`)
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
      const res = await fetch(`${API}/portfolio/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positions: portfolio.map(p => ({ code: p.code, amount: p.amount })) }),
      });
      const data = await res.json();
      setShareUrl(data.url);
      setShareModal(true);
      setShareCopied(false);
    } catch {
      // ignore
    } finally {
      setShareLoading(false);
    }
  }

  // ── Ticker animation in the header ───────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => setTicker(t => t + 1), 3000);
    return () => clearInterval(interval);
  }, []);

  // ── Recalculate ROI whenever selection or inputs change ───────────────────
  useEffect(() => {
    if (!selected) return;
    calculate();
  }, [selected, amount, targetRate]);

  // ── Fetch news whenever the selected currency changes ─────────────────────
  useEffect(() => {
    if (!selected) return;
    setHeadlines([]);
    setLoadingNews(true);
    fetch(`${API}/news/${selected.code}`)
      .then(r => r.json())
      .then(data => { setHeadlines(data); setLoadingNews(false); })
      .catch(() => setLoadingNews(false));
  }, [selected]);

  // ── Fetch rate history whenever the selected currency changes ─────────────
  useEffect(() => {
    if (!selected) return;
    setRateHistory([]);
    fetch(`${API}/history/${selected.code}?limit=24`)
      .then(r => r.json())
      .then(data => setRateHistory(data))
      .catch(() => {});
  }, [selected]);

  // ── Fetch hype history whenever the selected currency changes ─────────────
  useEffect(() => {
    if (!selected) return;
    setHypeHistory([]);
    fetch(`${API}/hype/${selected.code}?limit=8`)
      .then(r => { if (!r.ok) throw new Error("no data"); return r.json(); })
      .then(data => setHypeHistory(data))
      .catch(() => {});
  }, [selected]);

  async function calculate() {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { setResults(null); return; }

    // Always show current value immediately using the local rate
    const currentVal = amt * selected.rate;

    // Without a valid target rate, show only current value
    if (!targetRate || parseFloat(targetRate) <= 0) {
      setResults({ currentVal, targetVal: null, gain: null, roi: null });
      return;
    }

    // Cancel any previous in-flight request
    if (roiAbortRef.current) roiAbortRef.current.abort();
    const controller = new AbortController();
    roiAbortRef.current = controller;

    try {
      const res = await fetch(`${API}/roi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: selected.code,
          amount: amt,
          target_rate: parseFloat(targetRate),
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      setResults({
        currentVal: data.current_value,
        targetVal: data.target_value,
        gain: data.gain,
        roi: String(data.roi_percent.toFixed(2)),
        multiplier: data.multiplier,
      });
    } catch (err) {
      if (err.name === "AbortError") return; // stale request, ignore
      // API unreachable — fall back to client-side math
      const targetVal = amt * parseFloat(targetRate);
      const gain = targetVal - currentVal;
      const roi = ((gain / currentVal) * 100).toFixed(2);
      setResults({ currentVal, targetVal, gain, roi });
    }
  }

  const fmt = (n) => {
    if (n === null || n === undefined) return "—";
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
    return `$${n.toFixed(4)}`;
  };

  const filtered = currencies.filter(c =>
    c.code.toLowerCase().includes(search.toLowerCase()) ||
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const topHype = [...currencies].sort((a, b) => b.hype_score - a.hype_score).slice(0, 6);

  // ── Loading screen ────────────────────────────────────────────────────────
  if (loadingRates || !selected) {
    return (
      <div style={{
        minHeight: "100vh", background: "#070714", display: "flex",
        alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16,
      }}>
        <style>{`@keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.6;transform:scale(1.3)} }`}</style>
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: "linear-gradient(135deg, #ff4d4d, #ff8c00)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 20, animation: "pulse 1.5s infinite",
        }}>⚡</div>
        <div style={{ color: "#5a5a8a", fontSize: 12, letterSpacing: 3, textTransform: "uppercase" }}>
          Loading rates...
        </div>
      </div>
    );
  }

  const tickerCurrency = currencies[ticker % currencies.length];

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
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:#0d0d1a} ::-webkit-scrollbar-thumb{background:#1e1e3f;border-radius:2px}
        input:focus{outline:none!important} select:focus{outline:none!important}
      `}</style>

      {/* Disclaimer banner */}
      <div style={{
        background: "#0a0a1a", borderBottom: "1px solid #2a1a00",
        padding: "7px 20px", textAlign: "center", fontSize: 11,
        color: "#7a6a40", letterSpacing: 0.3,
      }}>
        ⚠ Project Hype is a <strong style={{ color: "#a08040" }}>speculative research tool</strong> — scores reflect news activity and short-term rate signals, not financial fundamentals. <strong style={{ color: "#a08040" }}>Not investment advice.</strong> Do your own research.
      </div>

      {/* Header */}
      <div style={{
        background: "linear-gradient(90deg, #070714 0%, #0d0d2e 50%, #070714 100%)",
        borderBottom: "1px solid #1e1e3f", padding: isMobile ? "0 16px" : "0 40px", height: 64,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "linear-gradient(135deg, #ff4d4d, #ff8c00)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, fontWeight: 700, boxShadow: "0 0 20px #ff4d4d44"
          }}>⚡</div>
          <div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 800, letterSpacing: 2, color: "#fff" }}>
              PROJECT <span style={{ color: "#ff4d4d" }}>HYPE</span>
            </div>
            {!isMobile && <div style={{ fontSize: 10, color: "#5a5a8a", letterSpacing: 3, textTransform: "uppercase" }}>Speculative Currency Intelligence</div>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <LiveDot />
          {!isMobile && (
            <span style={{ color: "#5a5a8a", fontSize: 12 }}>
              <span style={{ animation: "tick 3s ease infinite", display: "inline-block" }}>
                {tickerCurrency?.code} · {tickerCurrency?.rate.toFixed(8)}
                {tickerCurrency && <RateBadge live={tickerCurrency.live} />}
              </span>
            </span>
          )}
          {!isMobile && (
            <div style={{
              background: "#0d0d2e", border: "1px solid #1e1e3f",
              borderRadius: 20, padding: "4px 14px", fontSize: 12, color: "#5a5a8a"
            }}>
              {currencies.length} currencies tracked
            </div>
          )}
        </div>
      </div>

      {/* Main Grid */}
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: isMobile ? "16px" : "32px 40px", display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "1fr 380px", gap: 24 }}>

        {/* Left Column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

          {/* Nav Tabs */}
          <div style={{ display: "flex", gap: 4, background: "#0d0d1a", borderRadius: 10, padding: 4, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            {["calculator", "markets", "heatmap", "signals", "portfolio"].map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{
                padding: isMobile ? "8px 14px" : "8px 20px", borderRadius: 8, border: "none", cursor: "pointer", flexShrink: 0,
                background: activeTab === tab ? "linear-gradient(135deg, #1e1e4f, #252560)" : "transparent",
                color: activeTab === tab ? "#e8e8ff" : "#5a5a8a",
                fontSize: 13, textTransform: "capitalize", fontWeight: 600,
                transition: "all 0.2s", boxShadow: activeTab === tab ? "0 0 20px #252560" : "none"
              }}>
                {tab === "calculator" ? "⚡ ROI Calculator" : tab === "markets" ? "📊 Markets" : tab === "heatmap" ? "🔥 Hype Map" : tab === "signals" ? "🎯 Signal Strength" : `💼 Portfolio${portfolio.length > 0 ? ` (${portfolio.length})` : ""}`}
              </button>
            ))}
          </div>

          {activeTab === "calculator" && (
            <div style={{ animation: "slideIn 0.3s ease" }}>
              {/* Currency Selector + Inputs */}
              <div style={{
                background: "linear-gradient(135deg, #0d0d1a 0%, #111128 100%)",
                border: "1px solid #1e1e3f", borderRadius: 16, padding: isMobile ? 16 : 28,
                marginBottom: 20, animation: "glow 4s ease infinite"
              }}>
                <div style={{ marginBottom: 20 }}>
                  <label style={{ fontSize: 11, color: "#5a5a8a", letterSpacing: 2, textTransform: "uppercase", display: "block", marginBottom: 8 }}>
                    Select Currency
                  </label>
                  <div style={{ position: "relative" }}>
                    <input
                      placeholder="Search currencies..."
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      style={{
                        width: "100%", padding: "10px 16px", boxSizing: "border-box",
                        background: "#070714", border: "1px solid #1e1e3f",
                        borderRadius: "8px 8px 0 0", color: "#e8e8ff", fontSize: 13,
                        borderBottom: search ? "1px solid #1e1e3f" : "none"
                      }}
                    />
                    <select
                      value={selected.code}
                      onChange={e => setSelected(currencies.find(c => c.code === e.target.value))}
                      style={{
                        width: "100%", padding: "12px 16px", boxSizing: "border-box",
                        background: "#070714", border: "1px solid #1e1e3f",
                        borderTop: search ? "none" : "1px solid #1e1e3f",
                        borderRadius: search ? "0 0 8px 8px" : "8px",
                        color: "#e8e8ff", fontSize: 14, fontWeight: 600, cursor: "pointer",
                        appearance: "none",
                      }}
                      size={search ? Math.min(filtered.length, 5) : 1}
                    >
                      {(search ? filtered : currencies).map(c => (
                        <option key={c.code} value={c.code} style={{ background: "#0d0d1a" }}>
                          {c.flag} {c.code} — {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Selected currency info */}
                <div style={{
                  background: "#070714", borderRadius: 10, padding: "14px 16px",
                  marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center"
                }}>
                  <div>
                    <div style={{ fontSize: 24, marginBottom: 4 }}>{selected.flag}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Space Mono', monospace", color: "#00d4aa" }}>
                      {selected.rate.toFixed(8)} <span style={{ fontSize: 12, color: "#5a5a8a" }}>USD</span>
                      <RateBadge live={selected.live} />
                    </div>
                    <div style={{ marginTop: 4, marginBottom: 2, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 10, color: "#5a5a8a", letterSpacing: 1 }}>24H</span>
                      <ChangeChip value={selected.change_24h} />
                    </div>
                    <div style={{ fontSize: 12, color: "#5a5a8a", marginTop: 2 }}>{selected.story}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: "#5a5a8a", letterSpacing: 1, marginBottom: 6 }}>HYPE SCORE</div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                      <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'Space Mono', monospace", color: selected.hype_score >= 80 ? "#ff4d4d" : selected.hype_score >= 55 ? "#ffa500" : "#00d4aa" }}>
                        {Math.round(selected.hype_score ?? selected.hype)}
                      </div>
                      <HypeTrend history={hypeHistory} />
                    </div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
                  <div>
                    <label style={{ fontSize: 11, color: "#5a5a8a", letterSpacing: 2, textTransform: "uppercase", display: "block", marginBottom: 8 }}>
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
                    <label style={{ fontSize: 11, color: "#5a5a8a", letterSpacing: 2, textTransform: "uppercase", display: "block", marginBottom: 8 }}>
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
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Space Mono', monospace", color: results.targetVal ? "#ffa500" : "#2a2a4a" }}>
                      {results.targetVal ? fmt(results.targetVal) : "—"}
                    </div>
                    {results.targetVal && <div style={{ fontSize: 11, color: "#8a7a5a", marginTop: 6 }}>at {parseFloat(targetRate).toFixed(8)} USD</div>}
                  </div>
                  <div style={{
                    background: results.roi && parseFloat(results.roi) > 0 ? "linear-gradient(135deg, #0d1a1a, #111e1e)" : "linear-gradient(135deg, #1a0d0d, #1e1111)",
                    border: `1px solid ${results.roi ? (parseFloat(results.roi) > 0 ? "#1a3a3a" : "#3a1a1a") : "#1e1e3f"}`,
                    borderRadius: 12, padding: "20px"
                  }}>
                    <div style={{ fontSize: 11, color: "#5a8a8a", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>ROI</div>
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "'Space Mono', monospace", color: !results.roi ? "#2a2a4a" : parseFloat(results.roi) > 0 ? "#00d4aa" : "#ff4d4d" }}>
                      {results.roi ? `${parseFloat(results.roi) > 0 ? "+" : ""}${Number(results.roi).toLocaleString()}%` : "—"}
                    </div>
                    {results.gain != null && results.multiplier && (
                      <div style={{ fontSize: 11, color: "#5a8a8a", marginTop: 6 }}>
                        {fmt(results.gain)} · {results.multiplier.toFixed(2)}x
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{
                  background: "#0d0d1a", border: "1px dashed #1e1e3f", borderRadius: 12,
                  padding: 24, textAlign: "center", color: "#2a2a4a", fontSize: 13, marginBottom: 20
                }}>
                  Enter an amount to calculate your current holdings value
                </div>
              )}

              {/* Market Context */}
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 16 }}>
                <StatCard label="Market Cap" value={selected.mcap === "N/A" ? "—" : `$${selected.mcap}`} sub="Estimated" />
                <StatCard label="24h Volume" value={selected.vol === "N/A" ? "—" : `$${selected.vol}`} sub="Reported" />
                <div style={{
                  background: "linear-gradient(135deg, #0d0d1a 0%, #111128 100%)",
                  border: "1px solid #1e1e3f", borderRadius: 12, padding: "18px 20px", flex: 1
                }}>
                  <div style={{ fontSize: 11, color: "#5a5a8a", letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>Hype Score</div>
                  <HypeBar score={Math.round(selected.hype_score ?? selected.hype)} />
                  <div style={{ fontSize: 11, color: "#5a5a8a", marginTop: 8 }}>
                    {(selected.hype_score ?? selected.hype) >= 80 ? "🔥 Extreme speculation" : (selected.hype_score ?? selected.hype) >= 55 ? "⚡ Elevated interest" : "📊 Moderate tracking"}
                  </div>
                </div>
              </div>

              {/* Catalyst Signal */}
              {selected.catalyst_score != null && (() => {
                const cat = selected.catalyst_score;
                const sent = selected.sentiment ?? 0;
                const mom = selected.momentum_7d ?? 0;
                const catColor = cat >= 65 ? "#00d4aa" : cat >= 40 ? "#ffa500" : "#ff4d4d";
                const sentLabel = sent > 10 ? "Bullish narrative" : sent < -10 ? "Bearish narrative" : "Neutral narrative";
                const momLabel = mom > 0.5 ? `+${mom.toFixed(2)}% 7d momentum` : mom < -0.5 ? `${mom.toFixed(2)}% 7d decline` : "Flat rate trend";
                const signal = cat >= 65 ? "High speculative signal activity" : cat >= 40 ? "Mixed signals — limited catalyst data" : "Low signal activity";
                return (
                  <div style={{
                    background: "linear-gradient(135deg, #0d0d1a 0%, #111128 100%)",
                    border: `1px solid ${catColor}33`, borderRadius: 12, padding: "18px 20px", marginTop: 16
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                      <div>
                        <div style={{ fontSize: 11, color: "#5a5a8a", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>🎯 Signal Strength</div>
                        <div style={{ fontSize: 11, color: catColor }}>{signal}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'Space Mono', monospace", color: catColor }}>{Math.round(cat)}</div>
                        <div style={{ fontSize: 10, color: "#5a5a8a" }}>/ 100</div>
                      </div>
                    </div>
                    <div style={{ height: 6, background: "#1a1a2e", borderRadius: 3, overflow: "hidden", marginBottom: 12 }}>
                      <div style={{ width: `${cat}%`, height: "100%", background: catColor, borderRadius: 3, boxShadow: `0 0 8px ${catColor}` }} />
                    </div>
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10 }}>
                      <div style={{ fontSize: 11, color: sent > 10 ? "#00d4aa" : sent < -10 ? "#ff4d4d" : "#5a5a8a" }}>
                        📰 {sentLabel}
                      </div>
                      <div style={{ fontSize: 11, color: mom > 0.5 ? "#00d4aa" : mom < -0.5 ? "#ff4d4d" : "#5a5a8a" }}>
                        📈 {momLabel}
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: "#3a3a5a", borderTop: "1px solid #1a1a2e", paddingTop: 8 }}>
                      Signal strength reflects news activity & rate movement only — not a prediction or investment advice.
                    </div>
                  </div>
                );
              })()}

              {/* Latest Intel */}
              <div style={{
                background: "linear-gradient(135deg, #0d0d1a 0%, #111128 100%)",
                border: "1px solid #1e1e3f", borderRadius: 16, padding: 24, marginTop: 20
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: 1 }}>📰 LATEST INTEL</div>
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
                {loadingNews ? (
                  <div style={{ color: "#2a2a4a", fontSize: 12, textAlign: "center", padding: "16px 0" }}>Loading intel...</div>
                ) : headlines.length === 0 ? (
                  <div style={{ color: "#2a2a4a", fontSize: 12, textAlign: "center", padding: "16px 0" }}>No headlines available</div>
                ) : (
                  headlines.map((h, i) => (
                    <div key={i} style={{ padding: "10px 0", borderBottom: i < headlines.length - 1 ? "1px solid #0f0f22" : "none" }}>
                      <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
                          background: "#1e1e3f", color: "#5a5aaa", letterSpacing: 1,
                          maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>{h.source}</span>
                        {h.published_at && <span style={{ fontSize: 10, color: "#2a2a4a" }}>{new Date(h.published_at).toLocaleDateString()}</span>}
                      </div>
                      {h.url ? (
                        <a href={h.url} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: 12, color: "#9999cc", textDecoration: "none", lineHeight: 1.4 }}
                          onMouseEnter={e => e.currentTarget.style.color = "#e8e8ff"}
                          onMouseLeave={e => e.currentTarget.style.color = "#9999cc"}>
                          {h.title}
                        </a>
                      ) : (
                        <div style={{ fontSize: 12, color: "#5a5a8a", lineHeight: 1.4 }}>{h.title}</div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === "markets" && (
            <div style={{ animation: "slideIn 0.3s ease" }}>
              <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", borderRadius: 12, border: "1px solid #1e1e3f" }}>
              <div style={{ background: "#0d0d1a", borderRadius: 12, overflow: "hidden", minWidth: 680 }}>
                <div style={{
                  display: "grid", gridTemplateColumns: "40px 80px 1fr 120px 75px 80px 60px 80px",
                  gap: 12, padding: "12px 20px", borderBottom: "1px solid #1e1e3f",
                  fontSize: 10, color: "#5a5a8a", letterSpacing: 2, textTransform: "uppercase"
                }}>
                  <div></div><div>Code</div><div>Name</div><div>Rate (USD)</div><div>24h</div><div>Market Cap</div><div>Hype</div><div>Story</div>
                </div>
                {currencies.map((c) => (
                  <div
                    key={c.code}
                    onClick={() => { setSelected(c); setActiveTab("calculator"); }}
                    style={{
                      display: "grid", gridTemplateColumns: "40px 80px 1fr 120px 75px 80px 60px 80px",
                      gap: 12, padding: "12px 20px", cursor: "pointer",
                      borderBottom: "1px solid #0d0d1a",
                      background: selected.code === c.code ? "#111128" : "transparent",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = "#0f0f24"}
                    onMouseLeave={e => e.currentTarget.style.background = selected.code === c.code ? "#111128" : "transparent"}
                  >
                    <div style={{ fontSize: 18 }}>{c.flag}</div>
                    <div style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 13, color: "#00d4aa" }}>{c.code}</div>
                    <div style={{ fontSize: 13, color: "#9999cc" }}>{c.name}</div>
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: "#e8e8ff", display: "flex", alignItems: "center", gap: 4 }}>
                      {c.rate.toFixed(8)}
                      <RateBadge live={c.live} />
                    </div>
                    <div style={{ display: "flex", alignItems: "center" }}><ChangeChip value={c.change_24h} /></div>
                    <div style={{ fontSize: 12, color: "#5a5a8a" }}>{c.mcap === "N/A" ? "—" : `$${c.mcap}`}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: (c.hype_score ?? c.hype) >= 80 ? "#ff4d4d" : (c.hype_score ?? c.hype) >= 55 ? "#ffa500" : "#00d4aa" }}>{Math.round(c.hype_score ?? c.hype)}</div>
                    <div style={{ fontSize: 10, color: "#5a5a8a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.story.split(",")[0]}</div>
                  </div>
                ))}
              </div>
              </div>
            </div>
          )}

          {activeTab === "portfolio" && (() => {
            const pfFiltered = currencies.filter(c =>
              c.code.toLowerCase().includes(pfSearch.toLowerCase()) ||
              c.name.toLowerCase().includes(pfSearch.toLowerCase())
            );
            const totalUSD = portfolio.reduce((sum, p) => {
              const cur = currencies.find(c => c.code === p.code);
              return sum + (cur ? cur.rate * p.amount : 0);
            }, 0);

            return (
              <div style={{ animation: "slideIn 0.3s ease", display: "flex", flexDirection: "column", gap: 20 }}>

                {/* Shared-view banner */}
                {isSharedView && (
                  <div style={{
                    background: "linear-gradient(135deg, #0d1a2e, #111e3a)",
                    border: "1px solid #1e3a6e", borderRadius: 12,
                    padding: "14px 20px", display: "flex", alignItems: "center",
                    justifyContent: "space-between", gap: 12,
                  }}>
                    <div style={{ fontSize: 13, color: "#7799cc" }}>
                      👁 Viewing a shared portfolio
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
                      <label style={{ fontSize: 11, color: "#5a5a8a", letterSpacing: 2, textTransform: "uppercase", display: "block", marginBottom: 8 }}>Currency</label>
                      <input
                        placeholder="Search..."
                        value={pfSearch}
                        onChange={e => { setPfSearch(e.target.value); if (!pfCode) setPfCode(currencies[0]?.code ?? ""); }}
                        style={{
                          width: "100%", padding: "10px 14px", boxSizing: "border-box",
                          background: "#070714", border: "1px solid #1e1e3f",
                          borderRadius: pfSearch ? "8px 8px 0 0" : 8, color: "#e8e8ff", fontSize: 13,
                          borderBottom: pfSearch ? "1px solid #1e1e3f" : undefined,
                        }}
                      />
                      <select
                        value={pfCode || currencies[0]?.code || ""}
                        onChange={e => { setPfCode(e.target.value); setPfSearch(""); }}
                        size={pfSearch ? Math.min(pfFiltered.length, 5) : 1}
                        style={{
                          width: "100%", padding: "10px 14px", boxSizing: "border-box",
                          background: "#070714", border: "1px solid #1e1e3f",
                          borderTop: pfSearch ? "none" : "1px solid #1e1e3f",
                          borderRadius: pfSearch ? "0 0 8px 8px" : 8,
                          color: "#e8e8ff", fontSize: 13, fontWeight: 600, cursor: "pointer", appearance: "none",
                        }}
                      >
                        {(pfSearch ? pfFiltered : currencies).map(c => (
                          <option key={c.code} value={c.code} style={{ background: "#0d0d1a" }}>
                            {c.flag} {c.code} — {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: "#5a5a8a", letterSpacing: 2, textTransform: "uppercase", display: "block", marginBottom: 8 }}>Amount</label>
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
                          padding: "8px 18px", borderRadius: 8, border: "none", cursor: "pointer",
                          background: "linear-gradient(135deg, #1e3a1e, #253a25)",
                          border: "1px solid #00d4aa33",
                          color: "#00d4aa", fontSize: 12, fontWeight: 700, letterSpacing: 1,
                          transition: "opacity 0.15s",
                          opacity: shareLoading ? 0.5 : 1,
                        }}
                        onMouseEnter={e => e.currentTarget.style.opacity = "0.75"}
                        onMouseLeave={e => e.currentTarget.style.opacity = shareLoading ? "0.5" : "1"}
                      >
                        {shareLoading ? "…" : "🔗 SHARE"}
                      </button>
                    </div>
                  </div>
                )}

                {/* Position Rows */}
                {portfolio.length === 0 ? (
                  <div style={{
                    background: "#0d0d1a", border: "1px dashed #1e1e3f", borderRadius: 12,
                    padding: 32, textAlign: "center", color: "#2a2a4a", fontSize: 13,
                  }}>
                    No positions yet — add a currency above
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
                          <div style={{ fontSize: 26, flexShrink: 0 }}>{cur.flag}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                              <span style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 14, color: "#00d4aa" }}>{cur.code}</span>
                              <span style={{ fontSize: 12, color: "#5a5a8a" }}>{cur.name}</span>
                              <RateBadge live={cur.live} />
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
                            <div style={{ fontSize: 10, color: "#5a5a8a", marginTop: 4 }}>{pct.toFixed(1)}% of portfolio</div>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 16, color: "#e8e8ff" }}>
                              {fmt(posValue)}
                            </div>
                            <div style={{ fontSize: 11, color: hypeColor, fontWeight: 700 }}>
                              HYPE {Math.round(cur.hype_score ?? cur.hype)}
                            </div>
                          </div>
                          <button
                            onClick={() => removePosition(p.code)}
                            title="Remove position"
                            style={{
                              background: "none", border: "1px solid #1e1e3f", borderRadius: 6,
                              color: "#3a3a5a", fontSize: 14, cursor: "pointer",
                              padding: "4px 8px", flexShrink: 0, lineHeight: 1, transition: "all 0.15s",
                            }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = "#ff4d4d"; e.currentTarget.style.color = "#ff4d4d"; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = "#1e1e3f"; e.currentTarget.style.color = "#3a3a5a"; }}
                          >
                            ✕
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
            <div style={{ animation: "slideIn 0.3s ease" }}>
              <div style={{ marginBottom: 16, color: "#5a5a8a", fontSize: 13 }}>
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
                      onClick={() => { setSelected(c); setActiveTab("calculator"); }}
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
                      <div style={{ fontSize: Math.max(8, size / 5), lineHeight: 1 }}>{c.flag}</div>
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
            <div style={{ animation: "slideIn 0.3s ease" }}>
              <div style={{
                background: "linear-gradient(135deg, #0d0d1a 0%, #111128 100%)",
                border: "1px solid #1e1e3f", borderRadius: 16, padding: isMobile ? 16 : 24, marginBottom: 20
              }}>
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 18, letterSpacing: 1, marginBottom: 6 }}>
                    🎯 SPECULATIVE SIGNAL STRENGTH
                  </div>
                  <div style={{ fontSize: 12, color: "#5a5a8a", lineHeight: 1.6 }}>
                    Currencies ranked by <strong style={{ color: "#9999cc" }}>Catalyst Score</strong> — a composite of news sentiment and 7-day rate momentum. High scores indicate active narratives and recent movement, <strong style={{ color: "#7a6a40" }}>not a prediction or recommendation</strong>. Updated every 12 hours.
                  </div>
                </div>

                {/* Legend */}
                <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
                  {[["#00d4aa", "Bullish", ">10 sentiment"], ["#5a5a8a", "Neutral", "±10"], ["#ff4d4d", "Bearish", "<−10 sentiment"]].map(([color, label, sub]) => (
                    <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
                      <span style={{ fontSize: 11, color, fontWeight: 700 }}>{label}</span>
                      <span style={{ fontSize: 10, color: "#3a3a5a" }}>{sub}</span>
                    </div>
                  ))}
                </div>

                {/* Table header */}
                <div style={{
                  display: "grid", gridTemplateColumns: "28px 32px 1fr 110px 80px 70px",
                  gap: 10, padding: "8px 12px",
                  fontSize: 9, color: "#3a3a5a", letterSpacing: 2, textTransform: "uppercase",
                  borderBottom: "1px solid #1e1e3f"
                }}>
                  <div>#</div><div></div><div>Currency</div><div>Catalyst</div><div>Sentiment</div><div>7d Move</div>
                </div>

                {[...currencies]
                  .filter(c => c.catalyst_score != null)
                  .sort((a, b) => b.catalyst_score - a.catalyst_score)
                  .map((c, i) => {
                    const cat = c.catalyst_score ?? 0;
                    const sent = c.sentiment ?? 0;
                    const mom = c.momentum_7d ?? 0;
                    const catColor = cat >= 65 ? "#00d4aa" : cat >= 40 ? "#ffa500" : "#ff4d4d";
                    const sentColor = sent > 10 ? "#00d4aa" : sent < -10 ? "#ff4d4d" : "#5a5a8a";
                    const momColor = mom > 0 ? "#00d4aa" : mom < 0 ? "#ff4d4d" : "#5a5a8a";
                    const sentLabel = sent > 10 ? "BULLISH" : sent < -10 ? "BEARISH" : "NEUTRAL";
                    return (
                      <div
                        key={c.code}
                        onClick={() => { setSelected(c); setActiveTab("calculator"); }}
                        style={{
                          display: "grid", gridTemplateColumns: "28px 32px 1fr 110px 80px 70px",
                          gap: 10, padding: "12px 12px", cursor: "pointer",
                          borderBottom: "1px solid #0d0d1a",
                          background: selected.code === c.code ? "#111128" : "transparent",
                          transition: "background 0.15s",
                          borderRadius: i === 0 ? "8px 8px 0 0" : 0,
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = "#0f0f24"}
                        onMouseLeave={e => e.currentTarget.style.background = selected.code === c.code ? "#111128" : "transparent"}
                      >
                        {/* Rank */}
                        <div style={{ fontSize: 10, color: "#2a2a4a", fontFamily: "'Space Mono', monospace", paddingTop: 2 }}>{i + 1}</div>

                        {/* Flag */}
                        <div style={{ fontSize: 20 }}>{c.flag}</div>

                        {/* Name */}
                        <div>
                          <div style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 12, color: "#e8e8ff" }}>{c.code}</div>
                          <div style={{ fontSize: 10, color: "#5a5a8a", marginTop: 1 }}>{c.name}</div>
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
                            {sent > 0 ? "+" : ""}{sent.toFixed(0)}
                          </div>
                        </div>

                        {/* Momentum */}
                        <div style={{ fontSize: 12, fontFamily: "'Space Mono', monospace", color: momColor, fontWeight: 700 }}>
                          {mom > 0 ? "+" : ""}{mom.toFixed(2)}%
                        </div>
                      </div>
                    );
                  })}

                {currencies.filter(c => c.catalyst_score != null).length === 0 && (
                  <div style={{ textAlign: "center", padding: "40px 0", color: "#3a3a5a", fontSize: 13 }}>
                    Catalyst scores are computed on startup — check back in a moment.
                  </div>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Right Sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Top Hyped */}
          <div style={{
            background: "linear-gradient(135deg, #0d0d1a 0%, #111128 100%)",
            border: "1px solid #1e1e3f", borderRadius: 16, padding: 24
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: 1 }}>🔥 TOP HYPED</div>
              <div style={{ fontSize: 11, color: "#5a5a8a" }}>by hype score</div>
            </div>
            {topHype.map((c, i) => (
              <div
                key={c.code}
                onClick={() => setSelected(c)}
                style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "10px 0",
                  borderBottom: i < topHype.length - 1 ? "1px solid #0f0f22" : "none",
                  cursor: "pointer", transition: "all 0.15s"
                }}
                onMouseEnter={e => e.currentTarget.style.opacity = "0.7"}
                onMouseLeave={e => e.currentTarget.style.opacity = "1"}
              >
                <div style={{ color: "#2a2a4a", fontFamily: "'Space Mono', monospace", fontSize: 11, minWidth: 16 }}>#{i + 1}</div>
                <div style={{ fontSize: 22 }}>{c.flag}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#e8e8ff" }}>{c.code}</div>
                  <div style={{ fontSize: 11, color: "#5a5a8a" }}>{c.name}</div>
                </div>
                <div><HypeBar score={Math.round(c.hype_score ?? c.hype)} /></div>
              </div>
            ))}
          </div>

          {/* Quick Scenarios */}
          <div style={{
            background: "linear-gradient(135deg, #0d0d1a 0%, #111128 100%)",
            border: "1px solid #1e1e3f", borderRadius: 16, padding: 24
          }}>
            <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: 1, marginBottom: 16 }}>
              ⚡ QUICK SCENARIOS
            </div>
            <div style={{ fontSize: 12, color: "#5a5a8a", marginBottom: 14 }}>
              {selected.code} · {parseFloat(amount || 0).toLocaleString()} units
            </div>
            {[2, 5, 10, 50, 100].map(mult => {
              const tgt = selected.rate * mult;
              const val = parseFloat(amount || 0) * tgt;
              const gain = val - parseFloat(amount || 0) * selected.rate;
              return (
                <div
                  key={mult}
                  onClick={() => { setTargetRate(tgt.toFixed(10)); setActiveTab("calculator"); }}
                  style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "10px 12px", borderRadius: 8, marginBottom: 6,
                    background: "#070714", border: "1px solid #1e1e3f",
                    cursor: "pointer", transition: "all 0.15s"
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "#ffa500"; e.currentTarget.style.background = "#111128"; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = "#1e1e3f"; e.currentTarget.style.background = "#070714"; }}
                >
                  <div>
                    <span style={{ color: "#ffa500", fontWeight: 700, fontSize: 13 }}>{mult}x</span>
                    <span style={{ color: "#5a5a8a", fontSize: 11, marginLeft: 8 }}>revaluation</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#00d4aa", fontFamily: "'Space Mono', monospace" }}>{fmt(val)}</div>
                    <div style={{ fontSize: 10, color: "#5a5a8a" }}>+{fmt(gain)}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Latest Intel in sidebar — only on non-calculator tabs to avoid duplication */}
          {activeTab !== "calculator" && (
            <div style={{
              background: "linear-gradient(135deg, #0d0d1a 0%, #111128 100%)",
              border: "1px solid #1e1e3f", borderRadius: 16, padding: 24
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: 1 }}>📰 LATEST INTEL</div>
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
              {loadingNews ? (
                <div style={{ color: "#2a2a4a", fontSize: 12, textAlign: "center", padding: "16px 0" }}>Loading intel...</div>
              ) : headlines.length === 0 ? (
                <div style={{ color: "#2a2a4a", fontSize: 12, textAlign: "center", padding: "16px 0" }}>No headlines available</div>
              ) : (
                headlines.map((h, i) => (
                  <div key={i} style={{ padding: "10px 0", borderBottom: i < headlines.length - 1 ? "1px solid #0f0f22" : "none" }}>
                    <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
                        background: "#1e1e3f", color: "#5a5aaa", letterSpacing: 1,
                        maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{h.source}</span>
                      {h.published_at && <span style={{ fontSize: 10, color: "#2a2a4a" }}>{new Date(h.published_at).toLocaleDateString()}</span>}
                    </div>
                    {h.url ? (
                      <a href={h.url} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 12, color: "#9999cc", textDecoration: "none", lineHeight: 1.4 }}
                        onMouseEnter={e => e.currentTarget.style.color = "#e8e8ff"}
                        onMouseLeave={e => e.currentTarget.style.color = "#9999cc"}>
                        {h.title}
                      </a>
                    ) : (
                      <div style={{ fontSize: 12, color: "#5a5a8a", lineHeight: 1.4 }}>{h.title}</div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Rate History sparkline — flex:1 so it fills remaining sidebar height */}
          <div style={{
            background: "linear-gradient(135deg, #0d0d1a 0%, #111128 100%)",
            border: "1px solid #1e1e3f", borderRadius: 16, padding: 24,
            flex: 1, display: "flex", flexDirection: "column",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: 1 }}>📈 RATE HISTORY</div>
              <div style={{ fontSize: 11, color: "#5a5a8a" }}>{selected.code} · last {rateHistory.length} snapshots</div>
            </div>
            {(() => {
              const sparkColor = selected.change_24h == null ? "#5a5a8a" : selected.change_24h >= 0 ? "#00d4aa" : "#ff4d4d";
              const pts = [...rateHistory].reverse();
              const oldest = pts[0]?.rate;
              const newest = pts[pts.length - 1]?.rate;
              return (
                <>
                  {/* Flex-grow wrapper makes the SVG fill whatever height is available */}
                  <div style={{ flex: 1, minHeight: 56 }}>
                    <Sparkline data={rateHistory} color={sparkColor} height="100%" />
                  </div>
                  {rateHistory.length >= 2 && (
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
                      <div style={{ fontSize: 10, color: "#5a5a8a", fontFamily: "'Space Mono', monospace" }}>
                        {oldest?.toFixed(8)}
                      </div>
                      <div style={{ fontSize: 10, fontFamily: "'Space Mono', monospace", color: sparkColor, fontWeight: 700 }}>
                        {newest?.toFixed(8)}
                      </div>
                    </div>
                  )}
                  {rateHistory.length < 2 && (
                    <div style={{ fontSize: 11, color: "#2a2a4a", marginTop: 8 }}>
                      Updates every 15 min — check back soon.
                    </div>
                  )}
                </>
              );
            })()}
          </div>

        </div>
      </div>

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
              🔗 Share Portfolio
            </div>
            <div style={{ fontSize: 12, color: "#5a5a8a", marginBottom: 20 }}>
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
                {shareCopied ? "✓ COPIED" : "COPY"}
              </button>
            </div>
            <button
              onClick={() => setShareModal(false)}
              style={{
                width: "100%", padding: "10px", borderRadius: 8, border: "1px solid #1e1e3f",
                background: "transparent", color: "#5a5a8a", fontSize: 13, cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
