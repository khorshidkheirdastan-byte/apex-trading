import React, { useState, useEffect, useRef, useCallback } from 'react';

const ASSETS = ['NVDA', 'TSLA', 'AAPL', 'META', 'SPY', 'BTC', 'GOLD'];
const DEFAULT_PIN = '1234';
const PRICE_INTERVAL = 10000;
const APEX_INTERVAL = 30000;

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
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.4; } }
  @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
  @keyframes spin { to { transform: rotate(360deg); } }
`;

function fmt(n, d = 2) {
  if (n == null) return '—';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtPct(n) {
  if (n == null) return '—';
  return `${n > 0 ? '+' : ''}${fmt(n)}%`;
}
function color(n) { return n >= 0 ? COLORS.green : COLORS.red; }

function LockScreen({ onUnlock }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState(false);

  function press(d) {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) {
      if (next === DEFAULT_PIN) {
        onUnlock();
      } else {
        setErr(true);
        setTimeout(() => { setPin(''); setErr(false); }, 700);
      }
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: COLORS.bg, gap: 32 }}>
      <div style={{ fontSize: 13, letterSpacing: 6, color: COLORS.accent }}>APEX TRADING</div>
      <div style={{ fontSize: 11, color: COLORS.muted, letterSpacing: 3 }}>رمز ۴ رقمی</div>
      <div style={{ display: 'flex', gap: 16 }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{ width: 16, height: 16, borderRadius: '50%', background: i < pin.length ? COLORS.accent : 'transparent', border: `2px solid ${err ? COLORS.red : COLORS.accent}`, transition: 'background .15s' }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,72px)', gap: 12 }}>
        {[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map((d, i) => (
          <button key={i} onClick={() => d === '⌫' ? setPin(p => p.slice(0,-1)) : d !== '' ? press(String(d)) : null}
            style={{ width: 72, height: 72, borderRadius: 12, border: `1px solid ${COLORS.border}`, background: COLORS.panel, color: COLORS.text, fontSize: 22, fontFamily: 'inherit', cursor: d === '' ? 'default' : 'pointer', opacity: d === '' ? 0 : 1 }}
          >{d}</button>
        ))}
      </div>
      <div style={{ fontSize: 10, color: COLORS.muted, letterSpacing: 2 }}>پیش‌فرض: 1234</div>
    </div>
  );
}

function AssetCard({ symbol, price, prevPrice, history }) {
  const change = prevPrice ? ((price - prevPrice) / prevPrice) * 100 : 0;
  const c = color(change);
  const w = 180, h = 50;
  const data = history || [];
  let sparkline = null;
  if (data.length >= 2) {
    const mn = Math.min(...data), mx = Math.max(...data), rng = mx - mn || 1;
    const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - mn) / rng) * h}`).join(' ');
    sparkline = <svg width={w} height={h}><polyline points={pts} fill="none" stroke={c} strokeWidth={1.5} /></svg>;
  }

  return (
    <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, animation: 'fadeIn .3s ease' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 13, color: COLORS.accent, fontWeight: 700, letterSpacing: 2 }}>{symbol}</div>
        <div style={{ fontSize: 10, color: c, background: c + '22', padding: '2px 8px', borderRadius: 4 }}>{fmtPct(change)}</div>
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>${fmt(price)}</div>
      {sparkline}
    </div>
  );
}

function ApexEngine({ prices, portfolio }) {
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  const analyze = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/apex-brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prices,
          portfolio,
          message: 'تحلیل کن و تصمیم بگیر'
        })
      });
      const data = await r.json();
      if (data.success && data.decision) {
        const d = data.decision;
        setLog(l => [{
          time: new Date().toLocaleTimeString('fa'),
          symbol: d.asset || d.symbol || '—',
          action: d.action,
          reason: d.reasoning || d.reason || '',
        }, ...l.slice(0, 49)]);
      } else {
        setLog(l => [{ time: new Date().toLocaleTimeString('fa'), symbol: 'ERROR', action: '—', reason: data.error || 'خطای ناشناخته' }, ...l]);
      }
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
      <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
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

export default function App() {
  const [locked, setLocked] = useState(true);
  const [prices, setPrices] = useState({});
  const [prevPrices, setPrevPrices] = useState({});
  const [priceHistory, setPriceHistory] = useState({});
  const [portfolio] = useState({ cash: 10000, equity: 10000 });
  const [settings, setSettings] = useState({ capital: 10000, target: 15000 });

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
            if (d.price) next[sym] = [...(h[sym] || []).slice(-29), d.price];
          });
          return next;
        });
      }
    } catch (e) {
      console.log('خطا در دریافت قیمت:', e.message);
    }
  }, [prices]);

  useEffect(() => {
    if (locked) return;
    fetchPrices();
    const t = setInterval(fetchPrices, PRICE_INTERVAL);
    return () => clearInterval(t);
  }, [locked]);

  if (locked) return <><style>{CSS}</style><LockScreen onUnlock={() => setLocked(false)} /></>;

  const equity = portfolio.equity;
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
          {/* آمار */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
            {[
              { label: 'ارزش کل', value: `$${fmt(equity)}`, c: COLORS.accent },
              { label: 'سود/ضرر', value: `$${fmt(profit)}`, c: color(profit) },
              { label: 'نقد', value: `$${fmt(portfolio.cash)}`, c: COLORS.text },
              { label: 'موقعیت‌ها', value: '0', c: COLORS.text },
            ].map((s, i) => (
              <div key={i} style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 9, color: COLORS.muted, letterSpacing: 2, marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: s.c }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Progress */}
          <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '16px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: COLORS.muted }}>پیشرفت به هدف</div>
              <div style={{ fontSize: 10, color: COLORS.accent }}>{fmt(progress, 1)}%</div>
            </div>
            <div style={{ height: 6, background: COLORS.bg, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: `linear-gradient(90deg, ${COLORS.accent}, ${COLORS.green})`, borderRadius: 3, transition: 'width .5s ease' }} />
            </div>
          </div>

          {/* APEX Engine */}
          <ApexEngine prices={prices} portfolio={portfolio} />

          {/* قیمت‌ها */}
          <div style={{ fontSize: 11, color: COLORS.muted, letterSpacing: 3 }}>قیمت‌های زنده</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {ASSETS.map(sym => (
              <AssetCard key={sym} symbol={sym} price={prices[sym]?.price} prevPrice={prevPrices[sym]?.price} history={priceHistory[sym] || []} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
