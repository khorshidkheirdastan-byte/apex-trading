import { useState, useEffect, useCallback } from "react";

const API_BASE = "https://apex-trading-qdu2.vercel.app";

const SYMBOLS = ["NVDA", "AAPL", "TSLA", "META", "SPY", "BTC", "GOLD"];

const symbolMeta = {
  NVDA: { label: "NVIDIA", icon: "🟢" },
  AAPL: { label: "Apple", icon: "🍎" },
  TSLA: { label: "Tesla", icon: "⚡" },
  META: { label: "Meta", icon: "🔵" },
  SPY: { label: "S&P 500", icon: "📈" },
  BTC: { label: "بیت‌کوین", icon: "₿" },
  GOLD: { label: "طلا", icon: "🥇" },
};

export default function App() {
  const [pin, setPin] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [pinError, setPinError] = useState(false);
  const [prices, setPrices] = useState({});
  const [prevPrices, setPrevPrices] = useState({});
  const [regime, setRegime] = useState(null);
  const [systemStatus, setSystemStatus] = useState(null);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineResult, setPipelineResult] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  const fetchPrices = useCallback(async () => {
    const newPrices = {};
    const newErrors = {};
    await Promise.all(
      SYMBOLS.map(async (sym) => {
        try {
          const res = await fetch(`${API_BASE}/price/${sym}`);
          if (!res.ok) throw new Error("خطا");
          const data = await res.json();
          newPrices[sym] = data.price ?? data.close ?? data.value ?? null;
        } catch {
          newErrors[sym] = true;
        }
      })
    );
    setPrevPrices((prev) => ({ ...prev, ...prices }));
    setPrices((prev) => ({ ...prev, ...newPrices }));
    setErrors(newErrors);
    setLastUpdate(new Date());
  }, [prices]);

  const fetchRegime = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/regime`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setRegime(data);
    } catch {
      setRegime(null);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/status`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSystemStatus(data);
    } catch {
      setSystemStatus(null);
    }
  }, []);

  const runPipeline = async () => {
    setPipelineRunning(true);
    setPipelineResult(null);
    try {
      const res = await fetch(`${API_BASE}/run-pipeline`, { method: "POST" });
      const data = await res.json();
      setPipelineResult({ success: res.ok, data });
    } catch {
      setPipelineResult({ success: false, data: { message: "خطا در اجرای Pipeline" } });
    }
    setPipelineRunning(false);
  };

  useEffect(() => {
    if (!authenticated) return;
    setLoading(true);
    Promise.all([fetchPrices(), fetchRegime(), fetchStatus()]).finally(() =>
      setLoading(false)
    );
    const interval = setInterval(() => {
      fetchPrices();
      fetchRegime();
      fetchStatus();
    }, 15000);
    return () => clearInterval(interval);
  }, [authenticated]);

  const handleLogin = () => {
    if (pin === "1234") {
      setAuthenticated(true);
      setPinError(false);
    } else {
      setPinError(true);
      setPin("");
    }
  };

  const getPriceChange = (sym) => {
    const curr = prices[sym];
    const prev = prevPrices[sym];
    if (!curr || !prev) return null;
    return ((curr - prev) / prev) * 100;
  };

  const regimeLabel = regime?.regime || regime?.market_regime || regime?.label || null;
  const statusLabel =
    systemStatus?.status || systemStatus?.system_status || systemStatus?.state || null;
  const isActive = statusLabel?.toUpperCase() === "ACTIVE";

  if (!authenticated) {
    return (
      <div style={styles.loginBg}>
        <div style={styles.loginCard}>
          <div style={styles.logoRow}>
            <span style={styles.logoIcon}>⬡</span>
            <span style={styles.logoText}>APEX</span>
            <span style={styles.logoSub}>TRADING</span>
          </div>
          <p style={styles.loginDesc}>برای ورود کد ۴ رقمی خود را وارد کنید</p>
          <div style={styles.pinRow}>
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                style={{
                  ...styles.pinDot,
                  background: pin.length > i ? "#00ffc8" : "transparent",
                  borderColor: pin.length > i ? "#00ffc8" : "#334155",
                }}
              />
            ))}
          </div>
          {pinError && <p style={styles.pinError}>کد اشتباه است. دوباره تلاش کنید.</p>}
          <div style={styles.numPad}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, "", 0, "⌫"].map((k, i) => (
              <button
                key={i}
                style={{
                  ...styles.numBtn,
                  opacity: k === "" ? 0 : 1,
                  pointerEvents: k === "" ? "none" : "auto",
                }}
                onClick={() => {
                  if (k === "⌫") setPin((p) => p.slice(0, -1));
                  else if (pin.length < 4) setPin((p) => p + k);
                }}
              >
                {k}
              </button>
            ))}
          </div>
          <button
            style={styles.loginBtn}
            onClick={handleLogin}
            disabled={pin.length < 4}
          >
            ورود
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.bg}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={styles.logoIcon}>⬡</span>
          <div>
            <div style={styles.headerTitle}>APEX TRADING</div>
            <div style={styles.headerSub}>سیستم معاملات هوشمند</div>
          </div>
        </div>
        <div style={styles.headerRight}>
          {lastUpdate && (
            <span style={styles.updateTime}>
              آخرین بروزرسانی: {lastUpdate.toLocaleTimeString("fa-IR")}
            </span>
          )}
          <div
            style={{
              ...styles.statusBadge,
              background: isActive ? "#00ffc822" : "#ff444422",
              borderColor: isActive ? "#00ffc8" : "#ff4444",
              color: isActive ? "#00ffc8" : "#ff4444",
            }}
          >
            <span style={{ ...styles.statusDot, background: isActive ? "#00ffc8" : "#ff4444" }} />
            {statusLabel ? (isActive ? "فعال" : "در انتظار") : "نامشخص"}
          </div>
        </div>
      </header>

      <main style={styles.main}>
        {/* Market Regime */}
        <section style={styles.regimeSection}>
          <div style={styles.sectionLabel}>رژیم بازار</div>
          <div style={styles.regimeValue}>
            {loading ? (
              <span style={styles.loading}>در حال بارگذاری...</span>
            ) : regimeLabel ? (
              <>
                <span style={styles.regimeIcon}>
                  {regimeLabel.toLowerCase().includes("bull") ? "🐂" :
                   regimeLabel.toLowerCase().includes("bear") ? "🐻" : "⚖️"}
                </span>
                {regimeLabel}
              </>
            ) : (
              <span style={styles.noData}>داده‌ای موجود نیست</span>
            )}
          </div>
        </section>

        {/* Prices Grid */}
        <section style={styles.pricesSection}>
          <div style={styles.sectionLabel}>قیمت‌های زنده</div>
          <div style={styles.pricesGrid}>
            {SYMBOLS.map((sym) => {
              const change = getPriceChange(sym);
              const price = prices[sym];
              const hasError = errors[sym];
              const isUp = change > 0;
              const isDown = change < 0;
              return (
                <div key={sym} style={styles.priceCard}>
                  <div style={styles.priceCardTop}>
                    <span style={styles.symIcon}>{symbolMeta[sym].icon}</span>
                    <div>
                      <div style={styles.symTicker}>{sym}</div>
                      <div style={styles.symLabel}>{symbolMeta[sym].label}</div>
                    </div>
                  </div>
                  <div style={styles.priceValue}>
                    {hasError ? (
                      <span style={styles.noData}>خطا</span>
                    ) : price != null ? (
                      <>
                        <span style={{ color: isUp ? "#00ffc8" : isDown ? "#ff4d6d" : "#e2e8f0" }}>
                          {typeof price === "number"
                            ? price.toLocaleString("en-US", { maximumFractionDigits: 2 })
                            : price}
                        </span>
                        {change != null && (
                          <span
                            style={{
                              ...styles.changeChip,
                              background: isUp ? "#00ffc822" : isDown ? "#ff4d6d22" : "#33415522",
                              color: isUp ? "#00ffc8" : isDown ? "#ff4d6d" : "#94a3b8",
                            }}
                          >
                            {isUp ? "▲" : isDown ? "▼" : "─"}{" "}
                            {Math.abs(change).toFixed(2)}%
                          </span>
                        )}
                      </>
                    ) : (
                      <span style={styles.loading}>...</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Pipeline */}
        <section style={styles.pipelineSection}>
          <div style={styles.sectionLabel}>اجرای Pipeline</div>
          <button
            style={{
              ...styles.pipelineBtn,
              opacity: pipelineRunning ? 0.7 : 1,
              cursor: pipelineRunning ? "not-allowed" : "pointer",
            }}
            onClick={runPipeline}
            disabled={pipelineRunning}
          >
            {pipelineRunning ? (
              <><span style={styles.spinner}>⟳</span> در حال اجرا...</>
            ) : (
              "▶  اجرای Pipeline"
            )}
          </button>
          {pipelineResult && (
            <div
              style={{
                ...styles.pipelineResult,
                borderColor: pipelineResult.success ? "#00ffc8" : "#ff4d6d",
                background: pipelineResult.success ? "#00ffc808" : "#ff4d6d08",
              }}
            >
              <span style={{ color: pipelineResult.success ? "#00ffc8" : "#ff4d6d" }}>
                {pipelineResult.success ? "✓ Pipeline با موفقیت اجرا شد" : "✗ خطا در اجرا"}
              </span>
              {pipelineResult.data?.message && (
                <div style={styles.pipelineMsg}>{pipelineResult.data.message}</div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

const styles = {
  loginBg: {
    minHeight: "100vh",
    background: "#020818",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Segoe UI', Tahoma, sans-serif",
  },
  loginCard: {
    background: "#0f172a",
    border: "1px solid #1e293b",
    borderRadius: 24,
    padding: "48px 40px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 20,
    minWidth: 340,
    boxShadow: "0 0 60px #00ffc811",
  },
  logoRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  logoIcon: { fontSize: 32, color: "#00ffc8" },
  logoText: {
    fontSize: 28,
    fontWeight: 800,
    color: "#e2e8f0",
    letterSpacing: 4,
  },
  logoSub: {
    fontSize: 11,
    color: "#64748b",
    fontWeight: 600,
    letterSpacing: 3,
    alignSelf: "flex-end",
    marginBottom: 4,
  },
  loginDesc: { color: "#64748b", fontSize: 14, margin: 0, direction: "rtl" },
  pinRow: { display: "flex", gap: 16, margin: "8px 0" },
  pinDot: {
    width: 16,
    height: 16,
    borderRadius: "50%",
    border: "2px solid #334155",
    transition: "all 0.2s",
  },
  pinError: { color: "#ff4d6d", fontSize: 13, margin: 0, direction: "rtl" },
  numPad: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 12,
    margin: "8px 0",
  },
  numBtn: {
    width: 64,
    height: 64,
    borderRadius: 14,
    background: "#1e293b",
    border: "1px solid #334155",
    color: "#e2e8f0",
    fontSize: 20,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.15s",
  },
  loginBtn: {
    width: "100%",
    padding: "14px 0",
    borderRadius: 14,
    background: "linear-gradient(135deg, #00ffc8, #0099ff)",
    border: "none",
    color: "#020818",
    fontSize: 16,
    fontWeight: 800,
    cursor: "pointer",
    letterSpacing: 2,
    direction: "rtl",
  },
  bg: {
    minHeight: "100vh",
    background: "#020818",
    fontFamily: "'Segoe UI', Tahoma, sans-serif",
    color: "#e2e8f0",
    direction: "rtl",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "20px 32px",
    borderBottom: "1px solid #1e293b",
    background: "#0a1628cc",
    backdropFilter: "blur(12px)",
    position: "sticky",
    top: 0,
    zIndex: 100,
  },
  headerLeft: { display: "flex", alignItems: "center", gap: 14 },
  headerTitle: { fontSize: 20, fontWeight: 800, letterSpacing: 3, color: "#e2e8f0" },
  headerSub: { fontSize: 11, color: "#64748b", letterSpacing: 1 },
  headerRight: { display: "flex", alignItems: "center", gap: 16 },
  updateTime: { fontSize: 12, color: "#64748b" },
  statusBadge: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 16px",
    borderRadius: 100,
    border: "1px solid",
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    animation: "pulse 2s infinite",
  },
  main: { padding: "32px", display: "flex", flexDirection: "column", gap: 32, maxWidth: 1200, margin: "0 auto" },
  sectionLabel: { fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 3, marginBottom: 16, textTransform: "uppercase" },
  regimeSection: {},
  regimeValue: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    fontSize: 28,
    fontWeight: 800,
    color: "#00ffc8",
    background: "#0f172a",
    border: "1px solid #1e293b",
    borderRadius: 16,
    padding: "20px 28px",
  },
  regimeIcon: { fontSize: 32 },
  pricesSection: {},
  pricesGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: 16,
  },
  priceCard: {
    background: "#0f172a",
    border: "1px solid #1e293b",
    borderRadius: 16,
    padding: "20px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    transition: "border-color 0.3s",
  },
  priceCardTop: { display: "flex", alignItems: "center", gap: 12 },
  symIcon: { fontSize: 24 },
  symTicker: { fontSize: 16, fontWeight: 800, color: "#e2e8f0", letterSpacing: 2 },
  symLabel: { fontSize: 11, color: "#64748b" },
  priceValue: { display: "flex", flexDirection: "column", gap: 4 },
  changeChip: {
    display: "inline-block",
    padding: "2px 10px",
    borderRadius: 100,
    fontSize: 12,
    fontWeight: 700,
    marginTop: 4,
    width: "fit-content",
  },
  pipelineSection: {},
  pipelineBtn: {
    padding: "16px 40px",
    background: "linear-gradient(135deg, #00ffc8, #0099ff)",
    border: "none",
    borderRadius: 14,
    color: "#020818",
    fontSize: 16,
    fontWeight: 800,
    letterSpacing: 2,
    display: "flex",
    alignItems: "center",
    gap: 10,
    transition: "all 0.2s",
  },
  spinner: { display: "inline-block", animation: "spin 1s linear infinite", fontSize: 18 },
  pipelineResult: {
    marginTop: 16,
    padding: "16px 20px",
    borderRadius: 12,
    border: "1px solid",
    fontSize: 14,
    fontWeight: 600,
  },
  pipelineMsg: { marginTop: 6, color: "#94a3b8", fontWeight: 400, fontSize: 13 },
  loading: { color: "#64748b", fontSize: 14 },
  noData: { color: "#334155", fontSize: 14 },
};
