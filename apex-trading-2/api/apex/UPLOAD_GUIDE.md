# راهنمای آپلود فایل‌های APEX

## مرحله ۱ — نصب وابستگی‌ها

در ریشه پروژه اجرا کنید:

```bash
npm install @supabase/supabase-js @vercel/kv resend
```

---

## مرحله ۲ — آپلود فایل‌ها

### فایل‌های جدید (NEW)

| فایل محلی | مقصد در پروژه |
|---|---|
| `lib/telegram.js` | `lib/telegram.js` |
| `lib/helpers.js` | `lib/helpers.js` |
| `api/data-validator.js` | `api/data-validator.js` |
| `api/market-regime.js` | `api/market-regime.js` |
| `api/atr-stop.js` | `api/atr-stop.js` |
| `api/entry-signal.js` | `api/entry-signal.js` |
| `api/liquidity-filter.js` | `api/liquidity-filter.js` |
| `api/smart-execution.js` | `api/smart-execution.js` |
| `api/background-jobs.js` | `api/background-jobs.js` |
| `api/critic-ai.js` | `api/critic-ai.js` |
| `api/ensemble-weight.js` | `api/ensemble-weight.js` |
| `api/weekly-report.js` | `api/weekly-report.js` |
| `api/ab-test.js` | `api/ab-test.js` |

### فایل‌های جایگزین (REPLACE)

| فایل محلی | مقصد — فایل موجود را جایگزین کنید |
|---|---|
| `api/pipeline.js` | `api/pipeline.js` ← موجود را حذف و جایگزین کنید |
| `api/backtest.js` | `api/backtest.js` ← موجود را حذف و جایگزین کنید |
| `lib/scenario-manager.js` | `lib/scenario-manager.js` ← موجود را حذف و جایگزین کنید |
| `vercel.json` | `vercel.json` ← موجود را جایگزین کنید |

---

## مرحله ۳ — متغیرهای محیطی در Vercel

به داشبورد Vercel بروید → Settings → Environment Variables
متغیرهای زیر را اضافه کنید:

```
ALPACA_DATA_URL=https://data.alpaca.markets
MAX_DAILY_LOSS_PERCENT=2
TELEGRAM_BOT_TOKEN=<توکن از BotFather>
TELEGRAM_CHAT_ID=<آیدی چت شما>
AI_MODEL_TIMEOUT=5000
DATA_FETCH_TIMEOUT=2000
POLYGON_CALLS_PER_SECOND=4
```

### دریافت توکن تلگرام:
1. در تلگرام با `@BotFather` صحبت کنید
2. `/newbot` را ارسال کنید
3. توکن دریافتی را در `TELEGRAM_BOT_TOKEN` قرار دهید
4. برای `TELEGRAM_CHAT_ID`: با `@userinfobot` صحبت کنید یا آیدی عددی چنل/گروه را وارد کنید

---

## مرحله ۴ — دیپلوی

```bash
vercel --prod
```

یا از داشبورد Vercel روی "Redeploy" کلیک کنید.

---

## بررسی نهایی

پس از دیپلوی این endpoint‌ها را تست کنید:

```
GET  /api/market-regime
GET  /api/ensemble-weight
GET  /api/background-jobs
POST /api/data-validator  body: {"tickers":["SPY","NVDA"]}
POST /api/pipeline        body: {"holdings":[]}
```
