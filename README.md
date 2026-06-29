Readme · MD

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
  Sirləri (`.env`) heç vaxt repo-ya, zip-ə və ya çata qoyma. `.gitignore`-da onsuz da var.

## Necə qurulub

Adi qatlı struktur: `routes` → `controller` → DB. Hər controller öz sahəsinə baxır
(`auth`, `student`, `teacher`, `admin`, `catalog`, `payment`, `schedule`). Ortaq şeylər
`utils/`-də (token, parol, email, ödəniş, validasiya). Arxa fon işləri `scheduler.js`-dədir
(keçmiş dərsləri bağlayır və s.).

Üç rol var: **student**, **teacher**, **admin**. Token JWT-dir, `Authorization: Bearer <token>`
başlığında gəlir. Rola görə icazə `middleware/auth.js`-dədir.

### Qeydiyyat və email təsdiqi

Qeydiyyat iki addımlıdır. İstifadəçi formu doldurur, backend hesabı yaradır amma
**təsdiqlənməmiş** saxlayır və email-ə 6 rəqəmli kod göndərir. Kod təsdiqlənənə qədər giriş
yoxdur. Bu, başqasının email-i ilə qeydiyyatın qarşısını alır.

```
POST /api/auth/register/student   → { requiresVerification: true, email }
POST /api/auth/verify-otp         → { user, token }     (kod düzdürsə)
POST /api/auth/resend-otp         → yeni kod
```

Google ilə giriş də var (`POST /api/auth/google`) — ID token serverdə yoxlanılır, Google
email-i təsdiqlədiyi üçün belə hesablar avtomatik təsdiqlənmiş sayılır. Frontend client ID-ni
`GET /api/auth/config`-dən oxuyur.

### Pul axını

Balans manatla işləyir, 20% komissiya platformaya qalır. Tələbə balans artırır
(minimum 10 ₼), sonra dərs rezerv edir — pul kisədən tutulur, ledger-də qeyd olunur.
Rezerv atomikdir: eyni slota iki tələbə eyni anda yazıla bilməz.

Ödəniş provayderi `.env`-dən seçilir:

- `stub` — açarsız, balans dərhal artır (lokal/test)
- `dodo` — hosted checkout, webhook ilə təsdiq. Dodo USD ilə işləyir, ona görə manat məbləği
  göndərməzdən əvvəl USD-yə çevrilir (`AZN_PER_USD`).
- `kapital` — Kapital Bank TXPG (real, AZN)
- `square` — kart, sandbox test üçün
  Dodo webhook-u: `POST /api/payments/dodo/webhook` (imza Standard Webhooks ilə yoxlanılır).
  Lokal testdə tunel yoxdursa, frontend `verify` endpoint-i ilə statusu birbaşa Dodo-dan oxuyur.

### Dərs görüşü və yazılış (Zoom)

Sadə saxlanılıb: Zoom API inteqrasiyası yoxdur. Müəllim slot yaradanda Zoom (və ya başqa)
linkini özü yapışdırır, link **slota** bağlanır — qrup dərsində bütün tələbələr eyni linkə
qoşulur. "Join" düyməsi dərsdən ~10 dəqiqə əvvəl aktivləşir.

Yazılış da əl ilədir: dərs bitəndən sonra müəllim yazılış linkini (öz Zoom/Drive linkini)
əlavə edir. Avtomatik cloud recording yoxdur, çünki o, pullu Zoom lisenziyası tələb edir.
Lazım olanda obyekt saxlama (R2) və ya per-teacher Zoom OAuth ilə genişləndirilə bilər.

### Fayl yükləmə

Hazırda şəkillər serverin `uploads/` qovluğuna düşür və `/uploads/...` ünvanından servis olunur.
**Diqqət:** efemerdir — disksiz PaaS-ə (Railway/Render) deploy edəndə hər restartda silinir.
Production üçün obyekt saxlamaya (R2/S3) keçmək lazımdır; validasiya onsuz da tam URL-i qəbul edir.

## Endpoint xülasəsi

Hamısı `/api` altındadır. Auth tələb edənlər `Bearer` token istəyir.

```
auth      /auth/register/student|teacher, /auth/verify-otp, /auth/resend-otp,
          /auth/login, /auth/google, /auth/me, /auth/forgot-password,
          /auth/reset-password, /auth/change-password, /auth/config
kataloq   /catalog/teachers, /catalog/teachers/:id (+ /slots, /reviews)   (açıq)
tələbə    /student/dashboard, /student/wallet, /student/wallet/topup,
          /student/bookings, /student/lessons, /student/lessons/:id/room,
          /student/account
müəllim   /teacher/profile, /teacher/profile/photo, /teacher/slots (+ bulk,
          /:id/meeting), /teacher/lessons, /teacher/lessons/:id/room,
          /teacher/lessons/:id/complete, /teacher/recordings, /teacher/earnings,
          /teacher/payouts
admin     /admin/teachers (+ approve/reject/suspend), /admin/students (+ ban)
```
