import { useState, useEffect, useRef } from "react";

const API = `${import.meta.env.VITE_API_URL ?? "http://localhost:8000"}/api`;

// ── Animated gradient mesh background ──────────────────────────────────────
function GradientMesh() {
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", zIndex: 0, pointerEvents: "none" }}>
      <style>{`
        @keyframes meshDrift1 { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(40px,-30px) scale(1.05)} 66%{transform:translate(-20px,20px) scale(0.98)} }
        @keyframes meshDrift2 { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(-30px,40px) scale(1.03)} 66%{transform:translate(25px,-15px) scale(1.07)} }
        @keyframes meshDrift3 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(20px,30px) scale(1.06)} }
      `}</style>
      <div style={{ position: "absolute", top: "-20%", left: "-10%", width: "60%", height: "70%",
        background: "radial-gradient(ellipse, #00d4aa0a 0%, transparent 70%)",
        animation: "meshDrift1 18s ease-in-out infinite" }} />
      <div style={{ position: "absolute", top: "10%", right: "-15%", width: "55%", height: "60%",
        background: "radial-gradient(ellipse, #7a6acd0a 0%, transparent 70%)",
        animation: "meshDrift2 22s ease-in-out infinite" }} />
      <div style={{ position: "absolute", bottom: "5%", left: "20%", width: "50%", height: "50%",
        background: "radial-gradient(ellipse, #00b4ff07 0%, transparent 70%)",
        animation: "meshDrift3 16s ease-in-out infinite" }} />
    </div>
  );
}

// ── Static mock dashboard card ──────────────────────────────────────────────
function MockDashboardCard() {
  return (
    <div style={{
      background: "linear-gradient(135deg, #0d0d1a 0%, #111128 100%)",
      border: "1px solid #1e1e3f", borderRadius: 16, padding: "20px 24px",
      maxWidth: 420, width: "100%", fontFamily: "'IBM Plex Sans', sans-serif",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ fontSize: 24 }}>🇮🇶</div>
        <div>
          <div style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 15, color: "#00d4aa" }}>IQD</div>
          <div style={{ fontSize: 11, color: "#8080aa" }}>Iraqi Dinar</div>
        </div>
        <div style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, padding: "2px 6px",
          borderRadius: 4, background: "#003322", color: "#00d4aa", border: "1px solid #00d4aa33" }}>LIVE</div>
      </div>
      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 13, color: "#e8e8ff", marginBottom: 16 }}>
        0.00077341 <span style={{ color: "#8080aa", fontSize: 10 }}>USD</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: "#8080aa", letterSpacing: 1, textTransform: "uppercase" }}>Hype Score</span>
            <span style={{ fontSize: 10, color: "#ffa500", fontFamily: "'Space Mono', monospace", fontWeight: 700 }}>72</span>
          </div>
          <div style={{ height: 5, background: "#1a1a2e", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: "72%", height: "100%", background: "#ffa500", borderRadius: 3, boxShadow: "0 0 8px #ffa500" }} />
          </div>
        </div>
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: "#8080aa", letterSpacing: 1, textTransform: "uppercase" }}>Catalyst Score</span>
            <span style={{ fontSize: 10, color: "#7a6acd", fontFamily: "'Space Mono', monospace", fontWeight: 700 }}>48</span>
          </div>
          <div style={{ height: 5, background: "#1a1a2e", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: "48%", height: "100%", background: "linear-gradient(90deg, #9b59b6, #7a6acd)", borderRadius: 3, boxShadow: "0 0 8px #7a6acd" }} />
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, borderTop: "1px solid #1e1e3f" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "#8080aa", marginBottom: 2 }}>Hold</div>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: "#e8e8ff" }}>20M</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "#8080aa", marginBottom: 2 }}>Value</div>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: "#00d4aa" }}>$15.5K</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "#8080aa", marginBottom: 2 }}>@ 10x</div>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: "#ffa500" }}>$155K</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Static hype bar for showcase ────────────────────────────────────────────
function ShowcaseBar({ score, color }) {
  return (
    <div style={{ height: 4, background: "#1a1a2e", borderRadius: 2, overflow: "hidden", marginTop: 8 }}>
      <div style={{ width: `${score}%`, height: "100%", background: color, borderRadius: 2, boxShadow: `0 0 6px ${color}` }} />
    </div>
  );
}

// ── Status indicator ─────────────────────────────────────────────────────────
function StatusIndicator() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    fetch(`${API}/status`)
      .then(r => r.json())
      .then(d => setStatus(d))
      .catch(() => setStatus({ db_status: "error" }));
  }, []);

  if (!status) return null;

  const ok = status.db_status === "ok";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{
        width: 7, height: 7, borderRadius: "50%",
        background: ok ? "#00d4aa" : "#ff4d4d",
        boxShadow: ok ? "0 0 6px #00d4aa" : "0 0 6px #ff4d4d",
      }} />
      <span style={{ fontSize: 11, color: ok ? "#00d4aa" : "#ff4d4d" }}>
        {ok ? "All systems operational" : "Degraded"}
      </span>
    </div>
  );
}

// ── Fade-in on scroll ─────────────────────────────────────────────────────
function FadeIn({ children, delay = 0 }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } },
      { threshold: 0.12 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(28px)",
        transition: `opacity 0.6s ease ${delay}ms, transform 0.6s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

// ── Main Landing component ──────────────────────────────────────────────────
export default function Landing() {
  const [windowWidth, setWindowWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1200
  );
  useEffect(() => {
    const h = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  const isMobile = windowWidth < 768;

  const SHOWCASE = [
    { flag: "🇮🇶", code: "IQD", story: "Revaluation forums have run hot on IQD for two decades. CBI is actively managing a peg rebuild.", score: 72, color: "#ffa500" },
    { flag: "🇰🇵", code: "KPW", story: "North Korean won. No official market. Black-market rate is the only signal that matters.", score: 88, color: "#ff4d4d" },
    { flag: "🇮🇷", code: "IRR", story: "Iranian rial under maximum sanctions pressure. Nuclear deal sentiment drives every spike.", score: 91, color: "#ff4d4d" },
    { flag: "🇱🇧", code: "LBP", story: "Lebanese pound. Three exchange rates in parallel. Dollarization accelerating.", score: 84, color: "#ff4d4d" },
    { flag: "🇿🇼", code: "ZWL", story: "Zimbabwe dollar — the world's most structurally interesting currency for hyperinflation watchers.", score: 79, color: "#ffa500" },
    { flag: "🇻🇪", code: "VES", story: "Venezuelan bolivar. Post-redenomination stabilization vs. ongoing dollarization.", score: 65, color: "#ffa500" },
  ];

  return (
    <div style={{
      minHeight: "100vh", background: "#070714", color: "#e8e8ff",
      fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&family=Syne:wght@700;800&display=swap');
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.6;transform:scale(1.3)} }
        @keyframes glowPulse { 0%,100%{box-shadow:0 0 24px #00d4aa44,0 0 48px #00d4aa22} 50%{box-shadow:0 0 40px #00d4aa88,0 0 80px #00d4aa44} }
        @keyframes meshDrift1 { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(40px,-30px) scale(1.05)} 66%{transform:translate(-20px,20px) scale(0.98)} }
        @keyframes meshDrift2 { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(-30px,40px) scale(1.03)} 66%{transform:translate(25px,-15px) scale(1.07)} }
        @keyframes meshDrift3 { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(20px,30px) scale(1.06)} }
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:#0d0d1a} ::-webkit-scrollbar-thumb{background:#1e1e3f;border-radius:2px}
      `}</style>

      {/* ── NAV ── */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 100,
        background: "linear-gradient(90deg, #070714 0%, #0d0d2e 50%, #070714 100%)",
        borderBottom: "1px solid #1e1e3f",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: isMobile ? "0 16px" : "0 48px", height: 60,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9,
            background: "linear-gradient(135deg, #ff4d4d, #ff8c00)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, boxShadow: "0 0 16px #ff4d4d44",
          }}>⚡</div>
          <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 16, fontWeight: 800, letterSpacing: 2, color: "#fff" }}>
            PROJECT <span style={{ color: "#ff4d4d" }}>HYPE</span>
          </div>
        </div>
        <a
          href="/app"
          style={{
            padding: "8px 20px", borderRadius: 8, fontSize: 13, fontWeight: 700,
            background: "linear-gradient(135deg, #00d4aa, #00b4ff)",
            color: "#070714", textDecoration: "none", letterSpacing: 0.5,
          }}
        >
          Open Dashboard
        </a>
      </nav>

      {/* ── HERO ── */}
      <section style={{
        position: "relative", minHeight: isMobile ? "auto" : "92vh",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: isMobile ? "60px 20px" : "80px 48px",
        overflow: "hidden",
      }}>
        <GradientMesh />
        <div style={{ position: "relative", zIndex: 1, maxWidth: 1200, width: "100%",
          display: "flex", flexDirection: isMobile ? "column" : "row",
          alignItems: "center", gap: isMobile ? 48 : 64 }}>
          {/* Left: copy */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              display: "inline-block", fontSize: 11, fontWeight: 700, letterSpacing: 2,
              color: "#00d4aa", background: "#00d4aa10", border: "1px solid #00d4aa33",
              borderRadius: 20, padding: "4px 14px", marginBottom: 24, textTransform: "uppercase",
            }}>
              40 currencies · Free · No account
            </div>
            <h1 style={{
              fontFamily: "'Syne', sans-serif", fontWeight: 800,
              fontSize: isMobile ? 36 : 56, lineHeight: 1.1,
              margin: "0 0 20px 0", color: "#fff",
            }}>
              The Intelligence Layer<br />
              <span style={{ background: "linear-gradient(90deg, #00d4aa, #00b4ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                for Speculative Currency.
              </span>
            </h1>
            <p style={{
              fontSize: isMobile ? 15 : 17, color: "#9999cc", lineHeight: 1.7,
              margin: "0 0 36px 0", maxWidth: 520,
            }}>
              Real-time hype scoring, NLP catalyst analysis, and ROI modeling for the 40 currencies
              that IQD forums, IRR sanctions traders, and ZWL hyperinflation watchers are actually
              watching — updated every 12 hours from live GDELT headlines and exchange rate feeds.
            </p>
            <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "flex-start" : "center", gap: 16 }}>
              <a
                href="/app"
                style={{
                  display: "inline-block", padding: "14px 32px",
                  borderRadius: 12, fontSize: 15, fontWeight: 700, letterSpacing: 0.5,
                  background: "linear-gradient(135deg, #00d4aa, #00b4ff)",
                  color: "#070714", textDecoration: "none",
                  animation: "glowPulse 3s ease-in-out infinite",
                  boxShadow: "0 0 24px #00d4aa44",
                }}
              >
                Open Dashboard →
              </a>
              <span style={{ fontSize: 12, color: "#5c5c8a" }}>40 currencies tracked. Free.</span>
            </div>
          </div>
          {/* Right: mock dashboard */}
          <div style={{ flexShrink: 0 }}>
            <MockDashboardCard />
          </div>
        </div>
      </section>

      {/* ── FEATURE GRID ── */}
      <section style={{ padding: isMobile ? "60px 20px" : "80px 48px", maxWidth: 1200, margin: "0 auto" }}>
        <FadeIn>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <h2 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: isMobile ? 28 : 38,
              margin: "0 0 12px 0", color: "#e8e8ff" }}>
              What it actually does
            </h2>
            <p style={{ fontSize: 15, color: "#8080aa", margin: 0 }}>
              Three tools. One dashboard. Built for the retail speculator who already knows the thesis.
            </p>
          </div>
        </FadeIn>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 20 }}>
          {[
            {
              icon: "🔥",
              color: "#ff4d4d",
              title: "Market Noise, Quantified",
              body: "The Hype Score measures how much attention a currency is getting right now — a composite of news article volume, recency weighting (last 24h counts 3×), and 7-day rate volatility. Exotic and sanctioned currencies that stay interesting regardless of news cycle get a structural floor so they don't disappear from the board when headlines go quiet. Score of 80+ means it's loud. Below 40 means the narrative has cooled.",
              delay: 0,
            },
            {
              icon: "⚡",
              color: "#00b4ff",
              title: "Signal, Not Noise",
              body: "The Catalyst Score is the forward-looking metric — built from VADER NLP sentiment analysis on live GDELT headlines (60% weight) and 7-day rate momentum (40% weight). A high Catalyst Score means the narrative is turning positive and the rate is moving in the same direction. High hype + low catalyst = forum chatter with no follow-through. High catalyst = something is actually happening. That distinction is the entire point.",
              delay: 100,
            },
            {
              icon: "📊",
              color: "#ffa500",
              title: "Model the Upside",
              body: "The ROI Modeler answers one question: if this currency revalues to X, what are my holdings worth? Enter how much you hold, set a target rate, and see current value, projected value, gain, and multiplier. Built specifically for currencies priced in fractions of a cent where a 100,000% ROI sounds impressive but a 1,000× multiplier is the number that actually matters. Quick Scenarios let you pressure-test 2×, 5×, 10×, 50×, and 100× in one click.",
              delay: 200,
            },
          ].map(({ icon, color, title, body, delay }) => (
            <FadeIn key={title} delay={delay}>
              <div style={{
                background: "linear-gradient(135deg, #0d0d1a 0%, #111128 100%)",
                border: `1px solid ${color}22`,
                borderRadius: 16, padding: 28, height: "100%", boxSizing: "border-box",
              }}>
                <div style={{ fontSize: 32, marginBottom: 16 }}>{icon}</div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 17,
                  color, marginBottom: 12 }}>{title}</div>
                <p style={{ fontSize: 13, color: "#9999cc", lineHeight: 1.75, margin: 0 }}>{body}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </section>

      {/* ── CURRENCY SHOWCASE ── */}
      <section style={{ padding: isMobile ? "60px 20px" : "80px 48px", background: "#0a0a18" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <FadeIn>
            <div style={{ marginBottom: 40 }}>
              <h2 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: isMobile ? 28 : 38,
                margin: "0 0 12px 0", color: "#e8e8ff" }}>
                Tracking the world's most speculative currencies.
              </h2>
              <p style={{ fontSize: 15, color: "#8080aa", margin: 0, maxWidth: 640 }}>
                From Iraqi dinar revaluation forums to North Korean black market won — if retail
                speculators are talking about it, it's in here.
              </p>
            </div>
          </FadeIn>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(6, 1fr)", gap: 12 }}>
            {SHOWCASE.map(({ flag, code, story, score, color }, i) => (
              <FadeIn key={code} delay={i * 60}>
                <div style={{
                  background: "linear-gradient(135deg, #0d0d1a, #111128)",
                  border: "1px solid #1e1e3f", borderRadius: 12, padding: 16,
                }}>
                  <div style={{ fontSize: 28, marginBottom: 6 }}>{flag}</div>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700,
                    fontSize: 13, color, marginBottom: 6 }}>{code}</div>
                  <div style={{ fontSize: 11, color: "#7070aa", lineHeight: 1.5, marginBottom: 8 }}>{story}</div>
                  <ShowcaseBar score={score} color={color} />
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 10,
                    color, marginTop: 4, textAlign: "right" }}>{score}</div>
                </div>
              </FadeIn>
            ))}
          </div>
          <FadeIn delay={400}>
            <div style={{ textAlign: "center", marginTop: 32 }}>
              <a href="/app" style={{
                display: "inline-block", padding: "12px 28px", borderRadius: 10,
                border: "1px solid #1e1e3f", fontSize: 13, fontWeight: 600,
                color: "#9999cc", textDecoration: "none", background: "linear-gradient(135deg, #0d0d1a, #111128)",
                transition: "border-color 0.2s",
              }}>
                View all 40 currencies →
              </a>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── ALERTS SECTION ── */}
      <section style={{ padding: isMobile ? "60px 20px" : "80px 48px", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 48, alignItems: "flex-start" }}>
          <FadeIn>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 40, marginBottom: 20 }}>🔔</div>
              <h2 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: isMobile ? 28 : 36,
                margin: "0 0 16px 0", color: "#e8e8ff" }}>
                Know when the signal shifts.
              </h2>
              <p style={{ fontSize: 15, color: "#9999cc", lineHeight: 1.75, margin: "0 0 20px 0", maxWidth: 480 }}>
                When a currency's Catalyst Score jumps 15+ points between scoring cycles, something is
                changing — sentiment turned, rate moved, or a major headline landed. Catalyst spike alerts
                email you the moment that happens. No digest, no daily summary — just the signal, when it fires.
              </p>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {[["Free", "#00d4aa"], ["No spam", "#00b4ff"], ["Unsubscribe anytime", "#9999cc"]].map(([label, color]) => (
                  <span key={label} style={{
                    fontSize: 12, padding: "4px 12px", borderRadius: 20,
                    background: `${color}12`, border: `1px solid ${color}33`, color,
                  }}>{label}</span>
                ))}
              </div>
            </div>
          </FadeIn>

          <FadeIn delay={150}>
            <div style={{
              background: "#0d0d1a", border: "1px solid #1e1e3f", borderRadius: 16,
              padding: 24, flexShrink: 0, width: isMobile ? "100%" : 380, fontFamily: "'Space Mono', monospace",
            }}>
              {/* Mock email preview */}
              <div style={{ marginBottom: 12, padding: "8px 12px", background: "#070714",
                borderRadius: 8, border: "1px solid #1e1e3f",
                display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "linear-gradient(135deg, #ff4d4d, #ff8c00)",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, flexShrink: 0 }}>⚡</div>
                <div>
                  <div style={{ fontSize: 10, color: "#8080aa" }}>From: alerts@projecthype.io</div>
                  <div style={{ fontSize: 11, color: "#e8e8ff", fontWeight: 700 }}>🔔 IQD Catalyst Score spiked +21 pts</div>
                </div>
              </div>
              <div style={{ padding: "14px 16px", background: "#070714", borderRadius: 10, border: "1px solid #1e3a5f" }}>
                <div style={{ fontSize: 11, color: "#5c5c8a", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1 }}>
                  Catalyst Alert · Project Hype
                </div>
                <div style={{ fontSize: 13, color: "#00b4ff", fontWeight: 700, marginBottom: 6 }}>
                  🇮🇶 IQD  <span style={{ color: "#00d4aa" }}>27 → 48</span>
                </div>
                <div style={{ fontSize: 11, color: "#7070aa", lineHeight: 1.6, marginBottom: 12 }}>
                  Catalyst Score jumped <span style={{ color: "#00d4aa" }}>+21 points</span> in the last scoring cycle.
                  Sentiment turned positive (VADER: +0.34) on GDELT headlines covering CBI reserve disclosures.
                  7-day rate momentum: <span style={{ color: "#ffa500" }}>+0.8%</span>.
                </div>
                <a href="/app" style={{
                  display: "block", textAlign: "center", padding: "9px", borderRadius: 8,
                  background: "linear-gradient(135deg, #0d1a2e, #0d2040)",
                  border: "1px solid #00b4ff33", color: "#00b4ff", fontSize: 12,
                  textDecoration: "none", fontWeight: 700,
                }}>
                  Open Dashboard →
                </a>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section style={{ padding: isMobile ? "60px 20px" : "80px 48px", background: "#0a0a18" }}>
        <FadeIn>
          <div style={{
            maxWidth: 700, margin: "0 auto", textAlign: "center",
            padding: isMobile ? "40px 24px" : "56px 48px",
            background: "linear-gradient(135deg, #0d0d1a 0%, #111128 100%)",
            border: "1px solid #1e1e3f", borderRadius: 24,
            position: "relative", overflow: "hidden",
          }}>
            <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 0%, #00d4aa06 0%, transparent 70%)", pointerEvents: "none" }} />
            <h2 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: isMobile ? 28 : 36,
              margin: "0 0 16px 0", color: "#e8e8ff", position: "relative" }}>
              The thesis is yours.<br />We track the signal.
            </h2>
            <p style={{ fontSize: 15, color: "#8080aa", margin: "0 0 32px 0", lineHeight: 1.7, position: "relative" }}>
              Free. No account. No paywall. 40 currencies, live rates, NLP sentiment, ROI modeling,
              portfolio tracking, and catalyst alerts — in one dashboard.
            </p>
            <a
              href="/app"
              style={{
                display: "inline-block", padding: "15px 40px", borderRadius: 12,
                fontSize: 15, fontWeight: 700, letterSpacing: 0.5, textDecoration: "none",
                background: "linear-gradient(135deg, #00d4aa, #00b4ff)",
                color: "#070714", animation: "glowPulse 3s ease-in-out infinite",
                boxShadow: "0 0 24px #00d4aa44", position: "relative",
              }}
            >
              Open Dashboard →
            </a>
          </div>
        </FadeIn>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{
        borderTop: "1px solid #1e1e3f", padding: isMobile ? "32px 20px" : "40px 48px",
        background: "#070714",
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr",
            gap: isMobile ? 24 : 0,
            alignItems: "center", marginBottom: 24,
          }}>
            {/* Left: logo + tagline */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 8,
                  background: "linear-gradient(135deg, #ff4d4d, #ff8c00)",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
                }}>⚡</div>
                <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 14, letterSpacing: 2, color: "#fff" }}>
                  PROJECT <span style={{ color: "#ff4d4d" }}>HYPE</span>
                </span>
              </div>
              <div style={{ fontSize: 11, color: "#5c5c8a", lineHeight: 1.5 }}>
                Speculative Currency Intelligence<br />v1.2.0
              </div>
            </div>

            {/* Center: links */}
            <div style={{ display: "flex", gap: 24, justifyContent: isMobile ? "flex-start" : "center", flexWrap: "wrap" }}>
              {[
                ["Dashboard", "/app"],
                ["GitHub", "https://github.com/wpf002/project_hype"],
              ].map(([label, href]) => (
                <a key={label} href={href} style={{
                  fontSize: 13, color: "#8080aa", textDecoration: "none",
                  transition: "color 0.15s",
                }}
                  onMouseEnter={e => e.currentTarget.style.color = "#e8e8ff"}
                  onMouseLeave={e => e.currentTarget.style.color = "#8080aa"}
                >{label}</a>
              ))}
            </div>

            {/* Right: disclaimer + status */}
            <div style={{ textAlign: isMobile ? "left" : "right" }}>
              <div style={{ fontSize: 11, color: "#5c5c8a", marginBottom: 8, fontStyle: "italic" }}>
                Not financial advice.<br />Built for speculators, by a speculator.
              </div>
              <StatusIndicator />
            </div>
          </div>

          {/* Bottom disclaimer */}
          <div style={{ borderTop: "1px solid #1e1e3f", paddingTop: 20, fontSize: 11, color: "#404060", lineHeight: 1.7 }}>
            Exchange rates: ExchangeRate-API (live, updated every 15 min) + analyst fallback rates for sanctioned currencies
            (IRR, KPW, ZWL, MMK, SYP, VES, LBP, SDG, YER, SOS). News and sentiment: GDELT Project via NewsAPI.
            NLP: VADER (Valence Aware Dictionary and sEntiment Reasoner). Alerts: SendGrid.
            Scores reflect news activity and short-term rate signals — not financial fundamentals.
            Data may be delayed up to 12 hours. All prices in USD.
          </div>
        </div>
      </footer>
    </div>
  );
}
