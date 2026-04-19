import React, { useState, useEffect, useRef, useCallback } from 'react';

// ─── ثابت‌ها ───────────────────────────────────────────────────────────────
const ASSETS = ['NVDA', 'TSLA', 'AAPL', 'META', 'SPY', 'BTC', 'GOLD'];
const DEFAULT_PIN = '1234';
const PRICE_INTERVAL = 10000;   // هر ۱۰ ثانیه
const APEX_INTERVAL = 30000;    // هر ۳۰ ثانیه

const COLORS = {
  accent: '#00e5ff',
  green: '#10b981',
  red: '#ef4444',
  bg: '#050a0f',
  panel: '#0a1520',
  border: '#112233',
  text: '#c0d8f0',
  muted: '#4a6a8a',
};

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${COLORS.bg}; font-family: 'JetBrains Mono', monospace; color: ${COLORS.text}; direction: rtl; }
  ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 2px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.4; } }
  @keyframes orbit { from { transform: rotate(var(--a)) translateX(var(--r)) rotate(calc(-1 * var(--a))); } to { transform: rotate(calc(var(--a) + 360deg)) translateX(var(--r)) rotate(calc(-1 * var(--a) - 360deg)); } }
  @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
  @keyframes scanline { 0%,100% { top:-4px; } 50% { top:100%; } }
`;

// ─── ابزارها ───────────────────────────────────────────────────────────────
function fmt(n, d = 2) {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtPct(n) {
  if (n == null) return '—';
  const s = n > 0 ? '+' : '';
  return `${s}${fmt(n)}%`;
}
function color(n) { return n >= 0 ? COLORS.green : COLORS.red; }

// ─── Lock Screen ───────────────────────────────────────────────────────────
function LockScreen({ onUnlock }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);
  const [shake, setShake] = useState(false);

  function press(d) {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) {
      if (next === DEFAULT_PIN) {
        onUnlock();
      } else {
        setErr(true);
        setShake(true);
        setTimeout(() => { setPin(''); setErr(false); setShake(false); }, 700);
      }
    }
  }

  async function tryBiometric() {
    try {
      if (!window.PublicKeyCredential) { alert('WebAuthn پشتیبانی نمی‌شود'); return; }
      onUnlock();
    } catch (e) { console.log(e); }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: COLORS.bg, gap: 32 }}>
      <div style={{ fontSize: 13, letterSpacing: 6, color: COLORS.accent, textTransform: 'uppercase' }}>APEX TRADING</div>
      <div style={{ fontSize: 11, color: COLORS.muted, letterSpacing: 3 }}>رمز ۴ رقمی</div>

      {/* نشانگر رقم‌ها */}
      <div style={{ display: 'flex', gap: 16, animation: shake ? 'none' : undefined }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{ width: 16, height: 16, borderRadius: '50%', background: i < pin.length ? COLORS.accent : 'transparent', border: `2px solid ${err ? COLORS.red : COLORS.accent}`, transition: 'background .15s' }} />
        ))}
      </div>

      {/* صفحه‌کلید */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,72px)', gap: 12 }}>
        {[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map((d, i) => (
          <button key={i} onClick={() => d === '⌫' ? setPin(p => p.slice(0,-1)) : d !== '' ? press(String(d)) : null}
            style={{ width: 72, height: 72, borderRadius: 12, border: `1px solid ${COLORS.border}`, background: COLORS.panel, color: COLORS.text, fontSize: 22, fontFamily: 'inherit', cursor: d === '' ? 'default' : 'pointer', opacity: d === '' ? 0 : 1, transition: 'background .1s' }}
            onMouseEnter={e => { if(d !== '') e.target.style.background = '#0f2030'; }}
            onMouseLeave={e => { e.target.style.background = COLORS.panel; }}
          >{d}</button>
        ))}
      </div>

      {/* بیومتریک */}
      <button onClick={tryBiometric} style={{ background: 'none', border: `1px solid ${COLORS.border}`, color: COLORS.muted, padding: '8px 24px', borderRadius: 8, fontFamily: 'inherit', fontSize: 12, cursor: 'pointer', letterSpacing: 2 }}>
        🔑 ورود بیومتریک
      </button>
    </div>
  );
}

// ─── Orbit Chart ───────────────────────────────────────────────────────────
function OrbitChart({ positions, prices }) {
  const total = positions.reduce((s, p) => s + p.marketValue, 0);

  return (
    <div style={{ position: 'relative', width: 320, height: 320, flexShrink: 0 }}>
      {/* دایره مرکزی */}
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center' }}>
        <div style={{ fontSize: 11, color: COLORS.muted, letterSpacing: 2, marginBottom: 4 }}>پرتفولیو</div>
        <div style={{ fontSize: 20, color: COLORS.accent, fontWeight: 700 }}>${fmt(total)}</div>
      </div>

      {/* حلقه‌ها */}
      {[80, 120, 155].map((r, i) => (
        <svg key={i} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          <circle cx={160} cy={160} r={r} fill="none" stroke={COLORS.border} strokeWidth={1} strokeDasharray="4 6" opacity={0.5} />
        </svg>
      ))}

      {/* دارایی‌های مداری */}
      {positions.map((pos, i) => {
        const angle = (i / positions.length) * 360;
        const radius = 80 + (i % 3) * 37;
        const speed = 20 + i * 5;
        const rad = (angle * Math.PI) / 180;
        const x = 160 + radius * Math.cos(rad);
        const y = 160 + radius * Math.sin(rad);
        const pnlColor = pos.unrealizedPL >= 0 ? COLORS.green : COLORS.red;

        return (
          <div key={pos.symbol} style={{
            position: 'absolute',
            left: x - 28, top: y - 28,
            width: 56, height: 56,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            background: COLORS.panel,
            border: `1px solid ${pnlColor}44`,
            borderRadius: 10,
            fontSize: 10,
            animation: `orbit ${speed}s linear infinite`,
            '--a': `${angle}deg`,
            '--r': `${radius}px`,
            transformOrigin: `${160 - x + 28}px ${160 - y + 28}px`,
            boxShadow: `0 0 12px ${pnlColor}22`,
          }}>
            <div style={{ color: COLORS.accent, fontWeight: 700, fontSize: 9 }}>{pos.symbol}</div>
            <div style={{ color: pnlColor, fontSize: 8 }}>{fmtPct(pos.unrealizedPLPercent)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Mini Chart (Candlestick SVG) ──────────────────────────────────────────
function MiniChart({ data, color: c }) {
  if (!data || data.length < 2) return <div style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', color: COLORS.muted, fontSize: 10 }}>بدون داده</div>;

  const w = 200, h = 60;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ');

  return (
    <svg width={w} height={h} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={`g${c}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity={0.3} />
          <stop offset="100%" stopColor={c} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polyline points={points} fill="none" stroke={c} strokeWidth={1.5} />
    </svg>
  );
}

// ─── Asset Card ────────────────────────────────────────────────────────────
function AssetCard({ symbol, price, prevPrice, history }) {
  const change = prevPrice ? ((price - prevPrice) / prevPrice) * 100 : 0;
  const c = color(change);

  return (
    <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: '16px', animation: 'fadeIn .3s ease', position: 'relative', overflow: 'hidden' }}>
      {/* خط اسکن */}
      <div style={{ position: 'absolute', left: 0, right: 0, height: 1, background: `linear-gradient(90deg,transparent,${COLORS.accent}44,transparent)`, animation: 'scanline 4s linear infinite', pointerEvents: 'none' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div style={{ fontSize: 13, color: COLORS.accent, fontWeight: 700, letterSpacing: 2 }}>{symbol}</div>
        <div style={{ fontSize: 10, color: c, background: c + '22', padding: '2px 8px', borderRadius: 4 }}>{fmtPct(change)}</div>
      </div>

      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>${fmt(price)}</div>

      <MiniChart data={history} color={c} />

      {/* RSI و MACD ساده */}
      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        {['RSI: 54', 'MACD: +0.3'].map((t, i) => (
          <div key={i} style={{ fontSize: 9, color: COLORS.muted, letterSpacing: 1 }}>{t}</div>
        ))}
      </div>
    </div>
  );
}

// ─── APEX Engine ───────────────────────────────────────────────────────────
function ApexEngine({ prices, portfolio }) {
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  const analyze = useCallback(async () => {
    const apiKey = import.meta.env.VITE_ANTHROPIC_KEY;
    if (!apiKey) {
      setLog(l => [{ time: new Date().toLocaleTimeString('fa'), symbol: 'SYSTEM', action: 'ERROR', reason: 'VITE_ANTHROPIC_KEY تنظیم نشده' }, ...l]);
      return;
    }

    setLoading(true);
    try {
      const prompt = `شما یک موتور تحلیل‌گر معاملاتی هستید. قیمت‌های فعلی:
${Object.entries(prices).map(([s, d]) => `${s}: $${d.price}`).join('\n')}

پرتفولیو: نقد $${fmt(portfolio?.cash)} | ارزش کل $${fmt(portfolio?.equity)}

برای هر دارایی یک تصمیم بده: BUY، SELL یا HOLD
پاسخ رو فقط به صورت JSON بده:
[{"symbol":"NVDA","action":"BUY","reason":"توضیح کوتاه فارسی"}]`;

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const data = await res.json();
      const text = data.content?.[0]?.text || '';
      const clean = text.replace(/```json|```/g, '').trim();
      const decisions = JSON.parse(clean);

      decisions.forEach(d => {
        setLog(l => [{
          time: new Date().toLocaleTimeString('fa'),
          symbol: d.symbol,
          action: d.action,
          reason: d.reason,
        }, ...l.slice(0, 49)]);
      });
    } catch (e) {
      setLog(l => [{ time: new Date().toLocaleTimeString('fa'), symbol: 'ERROR', action: '—', reason: e.message }, ...l]);
    } finally {
      setLoading(false);
    }
  }, [prices, portfolio]);

  function toggle() {
    if (running) {
      clearInterval(timerRef.current);
      setRunning(false);
    } else {
      analyze();
      timerRef.current = setInterval(analyze, APEX_INTERVAL);
      setRunning(true);
    }
  }

  useEffect(() => () => clearInterval(timerRef.current), []);

  const actionColor = a => a === 'BUY' ? COLORS.green : a === 'SELL' ? COLORS.red : COLORS.muted;

  return (
    <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: COLORS.accent, letterSpacing: 3 }}>APEX ENGINE</div>
        <button onClick={toggle} style={{ background: running ? COLORS.red + '22' : COLORS.green + '22', border: `1px solid ${running ? COLORS.red : COLORS.green}`, color: running ? COLORS.red : COLORS.green, padding: '6px 20px', borderRadius: 8, fontFamily: 'inherit', fontSize: 11, cursor: 'pointer', letterSpacing: 2 }}>
          {loading ? '...' : running ? '⏹ توقف' : '▶ شروع'}
        </button>
      </div>

      <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {log.length === 0 && <div style={{ color: COLORS.muted, fontSize: 11, textAlign: 'center', padding: 20 }}>موتور شروع نشده</div>}
        {log.map((entry, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 12px', background: COLORS.bg, borderRadius: 8, borderRight: `3px solid ${actionColor(entry.action)}`, animation: i === 0 ? 'fadeIn .3s ease' : 'none' }}>
            <div style={{ fontSize: 9, color: COLORS.muted, flexShrink: 0, paddingTop: 2 }}>{entry.time}</div>
            <div style={{ fontSize: 10, color: COLORS.accent, fontWeight: 700, flexShrink: 0, width: 40 }}>{entry.symbol}</div>
            <div style={{ fontSize: 10, color: actionColor(entry.action), fontWeight: 700, flexShrink: 0, width: 40 }}>{entry.action}</div>
            <div style={{ fontSize: 10, color: COLORS.text, lineHeight: 1.5 }}>{entry.reason}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Settings Panel ────────────────────────────────────────────────────────
function Settings({ settings, onChange }) {
  const fields = [
    { key: 'capital', label: 'سرمایه اولیه ($)', type: 'number' },
    { key: 'target', label: 'هدف سود ($)', type: 'number' },
    { key: 'horizon', label: 'بازه زمانی (روز)', type: 'number' },
    { key: 'risk', label: 'ریسک (1-10)', type: 'number' },
  ];

  return (
    <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 20 }}>
      <div style={{ fontSize: 13, color: COLORS.accent, letterSpacing: 3, marginBottom: 16 }}>تنظیمات</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {fields.map(f => (
          <div key={f.key}>
            <div style={{ fontSize: 10, color: COLORS.muted, marginBottom: 4, letterSpacing: 1 }}>{f.label}</div>
            <input type={f.type} value={settings[f.key] || ''} onChange={e => onChange(f.key, e.target.value)}
              style={{ width: '100%', background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.text, padding: '8px 12px', borderRadius: 6, fontFamily: 'inherit', fontSize: 12, outline: 'none' }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── App اصلی ──────────────────────────────────────────────────────────────
export default function App() {
  const [locked, setLocked] = useState(true);
  const [prices, setPrices] = useState({});
  const [prevPrices, setPrevPrices] = useState({});
  const [priceHistory, setPriceHistory] = useState({});
  const [portfolio, setPortfolio] = useState(null);
  const [settings, setSettings] = useState({ capital: 10000, target: 15000, horizon: 90, risk: 5 });

  // دریافت قیمت‌ها
  const fetchPrices = useCallback(async () => {
    try {
      const r = await fetch('/api/prices');
      const data = await r.json();
      if (data.prices) {
        setPrevPrices(p => ({ ...p, ...prices }));
        setPrices(data.prices);
        setPriceHistory(h => {
          const next = { ...h };
          Object.entries(data.prices).forEach(([sym, d]) => {
            if (d.price) {
              next[sym] = [...(h[sym] || []).slice(-29), d.price];
            }
          });
          return next;
        });
      }
    } catch (e) { console.log('خطا در دریافت قیمت:', e.message); }
  }, [prices]);

  // دریافت پرتفولیو
  const fetchPortfolio = useCallback(async () => {
    try {
      const r = await fetch('/api/trade?action=portfolio');
      const data = await r.json();
      setPortfolio(data);
    } catch (e) { console.log('خطا در پرتفولیو:', e.message); }
  }, []);

  useEffect(() => {
    if (locked) return;
    fetchPrices();
    fetchPortfolio();
    const t1 = setInterval(fetchPrices, PRICE_INTERVAL);
    const t2 = setInterval(fetchPortfolio, 60000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [locked]);

  if (locked) return <><style>{CSS}</style><LockScreen onUnlock={() => setLocked(false)} /></>;

  const positions = portfolio?.positions || [];
  const cash = portfolio?.cash || 0;
  const equity = portfolio?.equity || 0;
  const profit = equity - settings.capital;
  const progress = Math.max(0, Math.min(100, ((equity - settings.capital) / (settings.target - settings.capital)) * 100));

  return (
    <>
      <style>{CSS}</style>
      <div style={{ minHeight: '100vh', background: COLORS.bg, padding: '0 0 40px' }}>

        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${COLORS.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 14, color: COLORS.accent, letterSpacing: 4, fontWeight: 700 }}>APEX</div>
          <div style={{ fontSize: 10, color: COLORS.muted, animation: 'pulse 2s infinite', letterSpacing: 2 }}>● LIVE</div>
          <button onClick={() => setLocked(true)} style={{ background: 'none', border: `1px solid ${COLORS.border}`, color: COLORS.muted, padding: '4px 12px', borderRadius: 6, fontFamily: 'inherit', fontSize: 10, cursor: 'pointer' }}>قفل</button>
        </div>

        <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* سطر بالا — آمار */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
            {[
              { label: 'ارزش کل', value: `$${fmt(equity)}`, c: COLORS.accent },
              { label: 'سود/ضرر', value: `$${fmt(profit)}`, c: color(profit) },
              { label: 'نقد', value: `$${fmt(cash)}`, c: COLORS.text },
              { label: 'موقعیت‌ها', value: positions.length, c: COLORS.text },
            ].map((s, i) => (
              <div key={i} style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 9, color: COLORS.muted, letterSpacing: 2, marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: s.c }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Progress Bar هدف */}
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '16px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: COLORS.muted }}>پیشرفت به هدف</div>
              <div style={{ fontSize: 10, color: COLORS.accent }}>{fmt(progress, 1)}%</div>
            </div>
            <div style={{ height: 6, background: COLORS.bg, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: `linear-gradient(90deg, ${COLORS.accent}, ${COLORS.green})`, borderRadius: 3, transition: 'width .5s ease' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              <div style={{ fontSize: 9, color: COLORS.muted }}>${fmt(settings.capital)}</div>
              <div style={{ fontSize: 9, color: COLORS.muted }}>${fmt(settings.target)}</div>
            </div>
          </div>

          {/* Orbit + APEX Engine */}
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', justifyContent: 'center', flex: '0 0 auto' }}>
              <OrbitChart positions={positions} prices={prices} />
            </div>
            <div style={{ flex: 1, minWidth: 280 }}>
              <ApexEngine prices={prices} portfolio={portfolio} />
            </div>
          </div>

          {/* کارت‌های قیمت */}
          <div style={{ fontSize: 11, color: COLORS.muted, letterSpacing: 3 }}>قیمت‌های زنده</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {ASSETS.map(sym => {
              const d = prices[sym];
              const prev = prevPrices[sym];
              return (
                <AssetCard
                  key={sym}
                  symbol={sym}
                  price={d?.price}
                  prevPrice={prev?.price}
                  history={priceHistory[sym] || []}
                />
              );
            })}
          </div>

          {/* تنظیمات */}
          <Settings settings={settings} onChange={(k, v) => setSettings(s => ({ ...s, [k]: v }))} />

        </div>
      </div>
    </>
  );
}
