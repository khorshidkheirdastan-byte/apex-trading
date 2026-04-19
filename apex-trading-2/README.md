# APEX Trading App

## فایل‌ها
```
apex-trading/
├── package.json
├── vite.config.js
├── vercel.json
├── index.html
├── .env.example
├── api/
│   ├── prices.js     ← قیمت real-time از Polygon.io
│   └── trade.js      ← خرید/فروش از Alpaca
└── src/
    ├── main.jsx
    └── App.jsx       ← داشبورد کامل
```

## مراحل Deploy

### ۱. GitHub
1. برو به github.com
2. کلیک کن روی **New repository**
3. اسم: `apex-trading`
4. کلیک **Create repository**
5. فایل‌ها رو آپلود کن (دکمه **uploading an existing file**)

### ۲. Vercel
1. برو به vercel.com/dashboard
2. کلیک **Add New Project**
3. از GitHub ایمپورت کن → `apex-trading`
4. قبل از Deploy، **Environment Variables** رو اضافه کن:
   - `POLYGON_API_KEY` = کدی که از polygon.io گرفتی
   - `ALPACA_KEY` = بعداً اضافه می‌کنیم
   - `ALPACA_SECRET` = بعداً اضافه می‌کنیم
   - `VITE_ANTHROPIC_KEY` = از console.anthropic.com
5. کلیک **Deploy**

### ۳. تست
- URL می‌گیری مثل: `apex-trading.vercel.app`
- رمز پیش‌فرض: **1234**

## API Keys
- **Polygon.io**: https://polygon.io (رایگان)
- **Alpaca**: https://alpaca.markets (paper trading رایگان)
- **Anthropic**: https://console.anthropic.com
