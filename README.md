# EduCan — Backend

Azərbaycan üçün onlayn repetitor platforması. Tələbə müəllim tapır, dərsi rezerv edir,
balansından ödəyir; müəllim cədvəlini açır, dərs keçir, qazancını götürür. Bu repozitoriya
yalnız backend-dir (API). Frontend ayrıca işlənir və bu API-yə qoşulur.

Texnologiya: Node.js (ESM), Express, PostgreSQL. Üçüncü tərəf asılılığı minimumda saxlanılıb —
şifrələmə, token, OTP, webhook imzaları əsasən stdlib (`node:crypto`) ilə yazılıb.

## Tez başlamaq

Lazımdır: Node 18+ və işləyən bir PostgreSQL bazası.

```bash
npm install
cp .env.example .env        # sonra .env-i öz dəyərlərinlə doldur
npm run migrate             # cədvəlləri yaradır (idempotentdir, təkrar işlədə bilərsən)
npm run seed:admin -- admin@educan.az parol "Admin Adı"   # bir admin yaradır
npm run dev                 # localhost:4000-də işə düşür (--watch ilə)
```

Production-da `npm start` işlət.

Heç bir xarici açar (Zoom, Dodo, SMTP) olmadan da işləyir — o halda ödəniş "stub" rejimdə
balansı birbaşa artırır, email konsola yazılır, hər şeyi lokal sınaya bilərsən. Açarları
əlavə edəndə yalnız `.env` dəyişir, kod yox.

## Konfiqurasiya (.env)

Tam siyahı `.env.example`-dədir. Ən vacibləri:

- `DATABASE_URL` — Postgres bağlantısı
- `JWT_SECRET` — uzun təsadüfi sətir (`openssl rand -hex 32`)
- `FRONTEND_URL` — CORS üçün; frontend-in domeni (lokal: `http://localhost:5173`)
- `PAYMENT_PROVIDER` — `stub` | `square` | `kapital` | `dodo`
- `EMAIL_HOST` / `EMAIL_USER` / ... — boş qalsa email konsola düşür
- `STORAGE` — `local` | `r2`. Fayl saxlama rejimi (aşağıda)
