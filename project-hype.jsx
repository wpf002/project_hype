import { useState, useEffect, useRef } from "react";

const HYPE_CURRENCIES = [
  { code: "IQD", name: "Iraqi Dinar", flag: "🇮🇶", rate: 0.000763, mcap: "78B", vol: "12M", hype: 98, story: "Post-war reconstruction & revaluation rumors" },
  { code: "VND", name: "Vietnamese Dong", flag: "🇻🇳", rate: 0.0000394, mcap: "102B", vol: "8M", hype: 72, story: "Emerging market growth, forex controls" },
  { code: "IRR", name: "Iranian Rial", flag: "🇮🇷", rate: 0.0000238, mcap: "N/A", vol: "N/A", hype: 91, story: "Sanctions, black market divergence" },
  { code: "IDR", name: "Indonesian Rupiah", flag: "🇮🇩", rate: 0.0000617, mcap: "580B", vol: "45M", hype: 55, story: "Southeast Asia's largest economy" },
  { code: "KHR", name: "Cambodian Riel", flag: "🇰🇭", rate: 0.000246, mcap: "4B", vol: "1.2M", hype: 48, story: "Dollarized economy, reform speculation" },
  { code: "MMK", name: "Myanmar Kyat", flag: "🇲🇲", rate: 0.000476, mcap: "N/A", vol: "N/A", hype: 83, story: "Military junta, dual exchange rates" },
  { code: "LAK", name: "Lao Kip", flag: "🇱🇦", rate: 0.0000474, mcap: "2.1B", vol: "800K", hype: 44, story: "BRI debt, commodity links" },
  { code: "ZWL", name: "Zimbabwe Dollar", flag: "🇿🇼", rate: 0.000777, mcap: "N/A", vol: "N/A", hype: 89, story: "Hyperinflation, USD adoption, reset talk" },
  { code: "VES", name: "Venezuelan Bolívar", flag: "🇻🇪", rate: 0.0000277, mcap: "N/A", vol: "N/A", hype: 87, story: "Oil wealth vs. socialist collapse" },
  { code: "ARS", name: "Argentine Peso", flag: "🇦🇷", rate: 0.00104, mcap: "N/A", vol: "N/A", hype: 85, story: "Serial defaulter, Milei shock therapy" },
  { code: "TRY", name: "Turkish Lira", flag: "🇹🇷", rate: 0.0284, mcap: "N/A", vol: "N/A", hype: 76, story: "Unorthodox monetary policy, inflation" },
  { code: "LBP", name: "Lebanese Pound", flag: "🇱🇧", rate: 0.0000111, mcap: "N/A", vol: "N/A", hype: 92, story: "Banking collapse, haircut negotiations" },
  { code: "SYP", name: "Syrian Pound", flag: "🇸🇾", rate: 0.0000772, mcap: "N/A", vol: "N/A", hype: 80, story: "Post-conflict reconstruction potential" },
  { code: "AFN", name: "Afghan Afghani", flag: "🇦🇫", rate: 0.01415, mcap: "N/A", vol: "N/A", hype: 68, story: "Taliban sanctions, frozen reserves" },
  { code: "GHS", name: "Ghanaian Cedi", flag: "🇬🇭", rate: 0.0645, mcap: "N/A", vol: "N/A", hype: 52, story: "IMF bailout, debt restructuring" },
  { code: "NGN", name: "Nigerian Naira", flag: "🇳🇬", rate: 0.000635, mcap: "N/A", vol: "N/A", hype: 79, story: "Oil petrodollars, FX unification" },
  { code: "EGP", name: "Egyptian Pound", flag: "🇪🇬", rate: 0.0205, mcap: "N/A", vol: "N/A", hype: 66, story: "IMF lifeline, devaluation cycles" },
  { code: "PKR", name: "Pakistani Rupee", flag: "🇵🇰", rate: 0.00359, mcap: "N/A", vol: "N/A", hype: 63, story: "IMF dependency, political instability" },
  { code: "SLL", name: "Sierra Leone Leone", flag: "🇸🇱", rate: 0.0000458, mcap: "N/A", vol: "N/A", hype: 41, story: "Post-conflict, diamond/mineral wealth" },
  { code: "MZN", name: "Mozambican Metical", flag: "🇲🇿", rate: 0.01567, mcap: "N/A", vol: "N/A", hype: 38, story: "Natural gas discoveries, debt scandal" },
  { code: "UZS", name: "Uzbek Som", flag: "🇺🇿", rate: 0.0000783, mcap: "N/A", vol: "N/A", hype: 47, story: "Silk Road revival, liberalization" },
  { code: "KZT", name: "Kazakhstani Tenge", flag: "🇰🇿", rate: 0.00190, mcap: "N/A", vol: "N/A", hype: 43, story: "Oil wealth, Eurasian pivot" },
  { code: "BDT", name: "Bangladeshi Taka", flag: "🇧🇩", rate: 0.00849, mcap: "N/A", vol: "N/A", hype: 40, story: "Garment export powerhouse" },
  { code: "ETB", name: "Ethiopian Birr", flag: "🇪🇹", rate: 0.00712, mcap: "N/A", vol: "N/A", hype: 45, story: "Fastest growing African economy" },
  { code: "TZS", name: "Tanzanian Shilling", flag: "🇹🇿", rate: 0.000385, mcap: "N/A", vol: "N/A", hype: 37, story: "East Africa growth, gas potential" },
  { code: "SDG", name: "Sudanese Pound", flag: "🇸🇩", rate: 0.001672, mcap: "N/A", vol: "N/A", hype: 56, story: "Civil war chaos, oil split aftermath" },
  { code: "CDF", name: "Congolese Franc", flag: "🇨🇩", rate: 0.000345, mcap: "N/A", vol: "N/A", hype: 61, story: "Cobalt, coltan — critical mineral wealth" },
  { code: "SOS", name: "Somali Shilling", flag: "🇸🇴", rate: 0.00174, mcap: "N/A", vol: "N/A", hype: 50, story: "Failed state recovery, diaspora remit" },
  { code: "MNT", name: "Mongolian Tögrög", flag: "🇲🇳", rate: 0.000292, mcap: "N/A", vol: "N/A", hype: 39, story: "Rare earths, mining boom speculation" },
  { code: "AMD", name: "Armenian Dram", flag: "🇦🇲", rate: 0.00257, mcap: "N/A", vol: "N/A", hype: 42, story: "Russia money flows, diaspora capital" },
  { code: "GEL", name: "Georgian Lari", flag: "🇬🇪", rate: 0.362, mcap: "N/A", vol: "N/A", hype: 44, story: "Russia capital flight hub" },
  { code: "AZN", name: "Azerbaijani Manat", flag: "🇦🇿", rate: 0.588, mcap: "N/A", vol: "N/A", hype: 41, story: "Oil corridor, Karabakh windfall" },
  { code: "MKD", name: "North Macedonia Denar", flag: "🇲🇰", rate: 0.01742, mcap: "N/A", vol: "N/A", hype: 33, story: "EU accession path" },
  { code: "XOF", name: "West African CFA Franc", flag: "🌍", rate: 0.001634, mcap: "N/A", vol: "N/A", hype: 58, story: "De-dollarization push, French exit" },
  { code: "HTG", name: "Haitian Gourde", flag: "🇭🇹", rate: 0.00724, mcap: "N/A", vol: "N/A", hype: 46, story: "Political collapse, gang control" },
  { code: "STN", name: "São Tomé Dobra", flag: "🇸🇹", rate: 0.04318, mcap: "N/A", vol: "N/A", hype: 30, story: "Island microstate, oil exploration" },
  { code: "MVR", name: "Maldivian Rufiyaa", flag: "🇲🇻", rate: 0.0649, mcap: "N/A", vol: "N/A", hype: 32, story: "Tourism-dollar dependency, debt" },
  { code: "KPW", name: "North Korean Won", flag: "🇰🇵", rate: 0.00111, mcap: "N/A", vol: "N/A", hype: 95, story: "Ultimate black market — regime change play" },
  { code: "SCR", name: "Seychelles Rupee", flag: "🇸🇨", rate: 0.0724, mcap: "N/A", vol: "N/A", hype: 31, story: "Offshore finance, Indian Ocean hub" },
  { code: "YER", name: "Yemeni Rial", flag: "🇾🇪", rate: 0.000400, mcap: "N/A", vol: "N/A", hype: 77, story: "Civil war split, Saudi-backed north" },
];

const HYPE_COLORS = {
  high: "#ff4d4d",
  mid: "#ffa500",
  low: "#00d4aa",
};

function HypeBar({ score }) {
  const color = score >= 80 ? HYPE_COLORS.high : score >= 55 ? HYPE_COLORS.mid : HYPE_COLORS.low;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{
        flex: 1, height: 6, background: "#1a1a2e", borderRadius: 3, overflow: "hidden"
      }}>
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
      border: "1px solid #1e1e3f",
      borderRadius: 12,
      padding: "18px 20px",
      flex: 1,
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
        display: "inline-block", width: 8, height: 8,
        borderRadius: "50%", background: "#00d4aa",
        boxShadow: "0 0 8px #00d4aa",
        animation: "pulse 2s infinite"
      }} />
      <span style={{ color: "#00d4aa", fontSize: 12, letterSpacing: 1 }}>LIVE</span>
    </span>
  );
}

export default function ProjectHype() {
  const [selected, setSelected] = useState(HYPE_CURRENCIES[0]);
  const [amount, setAmount] = useState("20000000");
  const [targetRate, setTargetRate] = useState("");
  const [results, setResults] = useState(null);
  const [activeTab, setActiveTab] = useState("calculator");
  const [search, setSearch] = useState("");
  const [ticker, setTicker] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTicker(t => t + 1), 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    calculate();
  }, [selected, amount, targetRate]);

  function calculate() {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { setResults(null); return; }
    const currentVal = amt * selected.rate;
    let targetVal = null, gain = null, roi = null;
    if (targetRate && parseFloat(targetRate) > 0) {
      targetVal = amt * parseFloat(targetRate);
      gain = targetVal - currentVal;
      roi = ((gain / currentVal) * 100).toFixed(2);
    }
    setResults({ currentVal, targetVal, gain, roi });
  }

  const fmt = (n) => {
    if (n === null || n === undefined) return "—";
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
    return `$${n.toFixed(4)}`;
  };

  const filtered = HYPE_CURRENCIES.filter(c =>
    c.code.toLowerCase().includes(search.toLowerCase()) ||
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const topHype = [...HYPE_CURRENCIES].sort((a, b) => b.hype - a.hype).slice(0, 6);

  return (
    <div style={{
      minHeight: "100vh",
      background: "#070714",
      color: "#e8e8ff",
      fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif",
      padding: 0,
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&family=Syne:wght@700;800&display=swap');
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.6;transform:scale(1.3)} }
        @keyframes slideIn { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes glow { 0%,100%{box-shadow:0 0 20px #00d4aa22} 50%{box-shadow:0 0 40px #00d4aa44} }
        @keyframes tick { 0%{opacity:0;transform:translateX(-8px)} 20%{opacity:1;transform:translateX(0)} 80%{opacity:1} 100%{opacity:0;transform:translateX(8px)} }
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:#0d0d1a} ::-webkit-scrollbar-thumb{background:#1e1e3f;border-radius:2px}
        input:focus{outline:none!important}
        select:focus{outline:none!important}
      `}</style>

      {/* Header */}
      <div style={{
        background: "linear-gradient(90deg, #070714 0%, #0d0d2e 50%, #070714 100%)",
        borderBottom: "1px solid #1e1e3f",
        padding: "0 40px",
        height: 64,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 100,
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
            <div style={{ fontSize: 10, color: "#5a5a8a", letterSpacing: 3, textTransform: "uppercase" }}>Speculative Currency Intelligence</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <LiveDot />
          <span style={{ color: "#5a5a8a", fontSize: 12 }}>
            <span style={{ animation: "tick 3s ease infinite", display: "inline-block", key: ticker }}>
              {HYPE_CURRENCIES[ticker % HYPE_CURRENCIES.length]?.code} · {HYPE_CURRENCIES[ticker % HYPE_CURRENCIES.length]?.rate.toFixed(8)}
            </span>
          </span>
          <div style={{
            background: "#0d0d2e", border: "1px solid #1e1e3f",
            borderRadius: 20, padding: "4px 14px",
            fontSize: 12, color: "#5a5a8a"
          }}>
            {HYPE_CURRENCIES.length} currencies tracked
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "32px 40px", display: "grid", gridTemplateColumns: "1fr 380px", gap: 24 }}>

        {/* Left Column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

          {/* Nav Tabs */}
          <div style={{ display: "flex", gap: 4, background: "#0d0d1a", borderRadius: 10, padding: 4, width: "fit-content" }}>
            {["calculator", "markets", "heatmap"].map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{
                padding: "8px 20px", borderRadius: 8, border: "none", cursor: "pointer",
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
                border: "1px solid #1e1e3f", borderRadius: 16, padding: 28,
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
                      onChange={e => setSelected(HYPE_CURRENCIES.find(c => c.code === e.target.value))}
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
                      {(search ? filtered : HYPE_CURRENCIES).map(c => (
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

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
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
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>
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
                    {results.gain && <div style={{ fontSize: 11, color: "#5a8a8a", marginTop: 6 }}>Gain: {fmt(results.gain)}</div>}
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
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
              <div style={{
                background: "#0d0d1a", borderRadius: 12, overflow: "hidden",
                border: "1px solid #1e1e3f"
              }}>
                <div style={{
                  display: "grid", gridTemplateColumns: "40px 80px 1fr 100px 80px 60px 80px",
                  gap: 12, padding: "12px 20px",
                  borderBottom: "1px solid #1e1e3f",
                  fontSize: 10, color: "#5a5a8a", letterSpacing: 2, textTransform: "uppercase"
                }}>
                  <div></div><div>Code</div><div>Name</div><div>Rate (USD)</div><div>Market Cap</div><div>Hype</div><div>Story</div>
                </div>
                {HYPE_CURRENCIES.map((c, i) => (
                  <div
                    key={c.code}
                    onClick={() => { setSelected(c); setActiveTab("calculator"); }}
                    style={{
                      display: "grid", gridTemplateColumns: "40px 80px 1fr 100px 80px 60px 80px",
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
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: "#e8e8ff" }}>{c.rate.toFixed(8)}</div>
                    <div style={{ fontSize: 12, color: "#5a5a8a" }}>{c.mcap === "N/A" ? "—" : `$${c.mcap}`}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: c.hype >= 80 ? "#ff4d4d" : c.hype >= 55 ? "#ffa500" : "#00d4aa" }}>{c.hype}</div>
                    <div style={{ fontSize: 10, color: "#5a5a8a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.story.split(",")[0]}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "heatmap" && (
            <div style={{ animation: "slideIn 0.3s ease" }}>
              <div style={{ marginBottom: 16, color: "#5a5a8a", fontSize: 13 }}>
                Tile size = hype score. Color = intensity. Click to analyze.
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {[...HYPE_CURRENCIES].sort((a, b) => b.hype - a.hype).map(c => {
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
                <div>
                  <HypeBar score={c.hype} />
                </div>
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

          {/* News Placeholder */}
          <div style={{
            background: "linear-gradient(135deg, #0d0d1a 0%, #111128 100%)",
            border: "1px solid #1e1e3f", borderRadius: 16, padding: 24
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: 1 }}>📰 LATEST INTEL</div>
              <div style={{ fontSize: 10, color: "#1e1e3f", background: "#0d0d2e", borderRadius: 10, padding: "3px 10px" }}>SOON</div>
            </div>
            {[
              { tag: selected.code, headline: `${selected.name} monetary policy update`, time: "2h ago" },
              { tag: "MACRO", headline: "Fed signals extended hold amid global FX volatility", time: "4h ago" },
              { tag: "RUMOR", headline: "Revaluation speculation resurfaces on forums", time: "6h ago" },
            ].map((n, i) => (
              <div key={i} style={{
                padding: "10px 0", borderBottom: i < 2 ? "1px solid #0f0f22" : "none"
              }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
                    background: "#1e1e3f", color: "#5a5aaa", letterSpacing: 1
                  }}>{n.tag}</span>
                  <span style={{ fontSize: 10, color: "#2a2a4a" }}>{n.time}</span>
                </div>
                <div style={{ fontSize: 12, color: "#5a5a8a" }}>{n.headline}</div>
              </div>
            ))}
            <div style={{ marginTop: 12, fontSize: 11, color: "#2a2a4a", textAlign: "center" }}>
              NewsAPI integration coming — connect your key
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
