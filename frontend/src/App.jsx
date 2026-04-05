import { useState, useEffect, useRef } from "react";

const API = "http://localhost:8000/api";

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

  const topHype = [...currencies].sort((a, b) => b.hype - a.hype).slice(0, 6);

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
            {["calculator", "markets", "heatmap"].map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{
                padding: isMobile ? "8px 14px" : "8px 20px", borderRadius: 8, border: "none", cursor: "pointer", flexShrink: 0,
                background: activeTab === tab ? "linear-gradient(135deg, #1e1e4f, #252560)" : "transparent",
                color: activeTab === tab ? "#e8e8ff" : "#5a5a8a",
                fontSize: 13, textTransform: "capitalize", fontWeight: 600,
                transition: "all 0.2s", boxShadow: activeTab === tab ? "0 0 20px #252560" : "none"
              }}>
                {tab === "calculator" ? "⚡ ROI Calculator" : tab === "markets" ? "📊 Markets" : "🔥 Hype Map"}
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
                    <div style={{ fontSize: 12, color: "#5a5a8a", marginTop: 4 }}>{selected.story}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: "#5a5a8a", letterSpacing: 1, marginBottom: 6 }}>HYPE SCORE</div>
                    <div style={{ fontSize: 28, fontWeight: 700, fontFamily: "'Space Mono', monospace", color: selected.hype >= 80 ? "#ff4d4d" : selected.hype >= 55 ? "#ffa500" : "#00d4aa" }}>
                      {selected.hype}
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
                  <HypeBar score={selected.hype} />
                  <div style={{ fontSize: 11, color: "#5a5a8a", marginTop: 8 }}>
                    {selected.hype >= 80 ? "🔥 Extreme speculation" : selected.hype >= 55 ? "⚡ Elevated interest" : "📊 Moderate tracking"}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "markets" && (
            <div style={{ animation: "slideIn 0.3s ease" }}>
              <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", borderRadius: 12, border: "1px solid #1e1e3f" }}>
              <div style={{ background: "#0d0d1a", borderRadius: 12, overflow: "hidden", minWidth: 620 }}>
                <div style={{
                  display: "grid", gridTemplateColumns: "40px 80px 1fr 120px 80px 60px 80px",
                  gap: 12, padding: "12px 20px", borderBottom: "1px solid #1e1e3f",
                  fontSize: 10, color: "#5a5a8a", letterSpacing: 2, textTransform: "uppercase"
                }}>
                  <div></div><div>Code</div><div>Name</div><div>Rate (USD)</div><div>Market Cap</div><div>Hype</div><div>Story</div>
                </div>
                {currencies.map((c) => (
                  <div
                    key={c.code}
                    onClick={() => { setSelected(c); setActiveTab("calculator"); }}
                    style={{
                      display: "grid", gridTemplateColumns: "40px 80px 1fr 120px 80px 60px 80px",
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
                    <div style={{ fontSize: 12, color: "#5a5a8a" }}>{c.mcap === "N/A" ? "—" : `$${c.mcap}`}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: c.hype >= 80 ? "#ff4d4d" : c.hype >= 55 ? "#ffa500" : "#00d4aa" }}>{c.hype}</div>
                    <div style={{ fontSize: 10, color: "#5a5a8a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.story.split(",")[0]}</div>
                  </div>
                ))}
              </div>
              </div>
            </div>
          )}

          {activeTab === "heatmap" && (
            <div style={{ animation: "slideIn 0.3s ease" }}>
              <div style={{ marginBottom: 16, color: "#5a5a8a", fontSize: 13 }}>
                Tile size = hype score. Color = intensity. Click to analyze.
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {[...currencies].sort((a, b) => b.hype - a.hype).map(c => {
                  const size = 40 + (c.hype / 100) * 60;
                  const alpha = 0.2 + (c.hype / 100) * 0.8;
                  const color = c.hype >= 80 ? `rgba(255,77,77,${alpha})` : c.hype >= 55 ? `rgba(255,165,0,${alpha})` : `rgba(0,212,170,${alpha})`;
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
                      title={`${c.name} — Hype: ${c.hype}`}
                    >
                      <div style={{ fontSize: Math.max(8, size / 5), lineHeight: 1 }}>{c.flag}</div>
                      <div style={{ fontSize: Math.max(7, size / 6), fontWeight: 700, fontFamily: "'Space Mono', monospace", color: "#fff", marginTop: 2 }}>{c.code}</div>
                      {size > 70 && <div style={{ fontSize: 9, color: "rgba(255,255,255,0.7)" }}>{c.hype}</div>}
                    </div>
                  );
                })}
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
                <div><HypeBar score={c.hype} /></div>
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

          {/* Latest Intel — wired to /api/news/{code} */}
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
              <div style={{ color: "#2a2a4a", fontSize: 12, textAlign: "center", padding: "16px 0" }}>
                Loading intel...
              </div>
            ) : headlines.length === 0 ? (
              <div style={{ color: "#2a2a4a", fontSize: 12, textAlign: "center", padding: "16px 0" }}>
                No headlines available
              </div>
            ) : (
              headlines.map((h, i) => (
                <div
                  key={i}
                  style={{ padding: "10px 0", borderBottom: i < headlines.length - 1 ? "1px solid #0f0f22" : "none" }}
                >
                  <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
                      background: "#1e1e3f", color: "#5a5aaa", letterSpacing: 1,
                      maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {h.source}
                    </span>
                    {h.published_at && (
                      <span style={{ fontSize: 10, color: "#2a2a4a" }}>
                        {new Date(h.published_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  {h.url ? (
                    <a
                      href={h.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 12, color: "#9999cc", textDecoration: "none", lineHeight: 1.4 }}
                      onMouseEnter={e => e.currentTarget.style.color = "#e8e8ff"}
                      onMouseLeave={e => e.currentTarget.style.color = "#9999cc"}
                    >
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
      </div>
    </div>
  );
}
