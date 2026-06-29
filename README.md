# EduCan Backend — Auth + Teacher Profile + Admin

Express + PostgreSQL. Əhatə olunan etaplar:
- **Etap 1 — Auth:** qeydiyyat (student/teacher), login (bütün rollar), `/me`, parol sıfırlama.
- **Etap 2 — Müəllim profili + admin təsdiqi:** müəllim öz profilini doldurur/yeniləyir; admin müəllimləri siyahılayır, təsdiqləyir, rədd edir, dayandırır.
- **Etap 3 — Public kataloq:** ziyarətçilər təsdiqlənmiş müəllimləri filtr/sort/pagination ilə görür; tək müəllimin public profili.
- **Etap 4 — Cədvəl:** müəllim konkret vaxt slotları açır/silir; public açıq slotlar.
- **Etap 5 — Booking + wallet:** tələbə balans artırır və slot rezerv edir (atomik, race-safe), 24 saat qaydası ilə ləğv + geri ödəmə.
- **Etap 6 — Dərslər:** lesson room (müəllimin əl ilə verdiyi Zoom linki yalnız qoşulma pəncərəsində), müəllim dərsi tamamlayır və yazılışı əl ilə əlavə edir.
- **Etap 7 — Rəylər, qazanc, payout:** tamamlanmış dərsə rəy; müəllim qazancı (komissiya çıxılmaqla) və payout sorğusu; admin payout-u ödəyir.
- **Test konsolu:** `http://localhost:4000/` — bütün axını klikləyib yoxlamaq üçün sadə HTML interfeysi (backend özü verir).

Roller: `student`, `teacher`, `admin`.

## Qurulum

```bash
npm install                      # asılılıqları qur
cp .env.example .env             # env faylını yarat və dəyərləri doldur
# .env-də JWT_SECRET-i təsadüfi sətirlə əvəz et:
#   openssl rand -hex 32
npm run migrate                  # schema.sql-i DB-yə tətbiq et (PostgreSQL işləməlidir)
npm run seed:admin admin@educan.az SuperParol123 "EduCan Admin"   # admin yarat
npm run dev                      # serveri işə sal (default :4000)
```

PostgreSQL hazır olmalıdır və `.env`-dəki `DATABASE_URL` ona işarə etməlidir. Migration `pgcrypto` extension-ı (`gen_random_uuid()` üçün) avtomatik aktivləşdirir.

## Endpoint-lər

| Metod | Yol                          | Təsvir                                   | Auth |
|-------|------------------------------|------------------------------------------|------|
| GET   | `/api/health`                | Sağlamlıq yoxlaması                       | —    |
| GET   | `/api/teachers`              | Public kataloq (filtr/sort/pagination)    | —    |
| GET   | `/api/teachers/:id`          | Public müəllim profili (yalnız approved)  | —    |
| POST  | `/api/auth/register/student` | Tələbə qeydiyyatı                         | —    |
| POST  | `/api/auth/register/teacher` | Müəllim qeydiyyatı (status: pending)      | —    |
| POST  | `/api/auth/login`            | Login — `{ user, token, profileStatus }` | —    |
| GET   | `/api/auth/me`               | Cari istifadəçi                           | ✓    |
| POST  | `/api/auth/change-password`  | Parolu dəyiş (`{ current, new }`)         | ✓    |
| POST  | `/api/auth/logout`           | Çıxış (client token-i silir)              | ✓    |
| POST  | `/api/auth/forgot-password`  | Sıfırlama linki göndərir                  | —    |
| POST  | `/api/auth/reset-password`   | Yeni parol təyin edir                     | —    |
| GET   | `/api/teacher/profile`       | Müəllimin öz profili                       | müəllim |
| PATCH | `/api/teacher/profile`       | Profili qismən yeniləyir                   | müəllim |
| GET   | `/api/admin/teachers`        | Müəllim siyahısı (`?status=&page=&limit=`) | admin   |
| GET   | `/api/admin/teachers/:id`    | Tək müəllimin tam profili                  | admin   |
| POST  | `/api/admin/teachers/:id/approve`   | Təsdiqlə                            | admin   |
| POST  | `/api/admin/teachers/:id/reject`    | Rədd et (`{ reason }`)              | admin   |
| POST  | `/api/admin/teachers/:id/suspend`   | Dayandır (`{ reason? }`)            | admin   |
| POST  | `/api/admin/teachers/:id/reinstate` | Yenidən aktivləşdir                 | admin   |
| GET   | `/api/teachers/:id/slots`    | Public açıq slotlar                        | —    |
| GET   | `/api/teachers/:id/reviews`  | Public rəylər                              | —    |
| GET   | `/api/teacher/slots`         | Öz slotları                                | müəllim |
| POST  | `/api/teacher/slots`         | Slot aç (`{ startsAt, sessionType }`)      | müəllim |
| POST  | `/api/teacher/slots/bulk`    | Həftəlik təkrar slotlar yarat              | müəllim |
| DELETE| `/api/teacher/slots/:id`     | Slot sil (rezerv yoxdursa)                 | müəllim |
| PATCH | `/api/teacher/slots/:id/meeting` | Slota əl ilə Zoom linki bağla (`{ joinUrl, hostUrl? }`) | müəllim |
| GET   | `/api/teacher/lessons`       | Dərslər (`?status=`)                       | müəllim |
| GET   | `/api/teacher/lessons/:id/room`     | Lesson room (müəllim)               | müəllim |
| POST  | `/api/teacher/lessons/:id/complete` | Dərsi tamamla                       | müəllim |
| POST  | `/api/teacher/lessons/:id/recording`| Yazılış əlavə et (video fayl **və ya** `{ recordingUrl }`) | müəllim |
| GET   | `/api/teacher/earnings`      | Qazanc xülasəsi + payout-lar               | müəllim |
| POST  | `/api/teacher/payouts`       | Payout sorğusu (mövcud balansı)            | müəllim |
| GET   | `/api/student/wallet`        | Balans + tranzaksiyalar                    | tələbə  |
| POST  | `/api/student/wallet/topup`  | Balans artır (`{ amount }`)                | tələbə  |
| POST  | `/api/student/wallet/topup/:id/verify` | Ödənişi yenidən yoxla              | tələbə  |
| GET   | `/api/payments/return/:id`   | Bank callback (brauzer redirect)           | —    |
| POST  | `/api/student/bookings`      | Slot rezerv et (`{ slotId }`)              | tələbə  |
| GET   | `/api/student/lessons`       | Dərslərim (`?status=`)                     | tələbə  |
| GET   | `/api/student/lessons/:id`   | Lesson room (Zoom pəncərədə)               | tələbə  |
| POST  | `/api/student/lessons/:id/cancel`   | Ləğv et (24s qaydası, refund)       | tələbə  |
| POST  | `/api/student/reviews`       | Rəy (`{ bookingId, rating, comment }`)     | tələbə  |
| GET   | `/api/admin/dashboard`       | Statistika + platforma gəliri              | admin   |
| GET   | `/api/admin/lessons`         | Bütün dərslər (`?status=`)                 | admin   |
| GET   | `/api/admin/payments`        | Tranzaksiyalar + payout-lar                | admin   |
| POST  | `/api/admin/payouts/:id/pay` | Payout-u "ödənildi" işarələ                | admin   |

Token JWT-dir, `Authorization: Bearer <token>` başlığında göndərilir. Login rolu qaytarır — hara yönləndirmə qərarını frontend verir.

## Sürətli test (curl)

```bash
# Tələbə qeydiyyatı
curl -s -X POST localhost:4000/api/auth/register/student \
  -H 'Content-Type: application/json' \
  -d '{"fullName":"Murad H","email":"murad@test.az","region":"Bakı","password":"parol12345","confirmPassword":"parol12345","acceptTerms":true}'

# Login
curl -s -X POST localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"murad@test.az","password":"parol12345"}'

# /me (yuxarıdakı tokeni yapışdır)
curl -s localhost:4000/api/auth/me -H 'Authorization: Bearer <TOKEN>'
```

`forgot-password` çağırılanda sıfırlama linki email əvəzinə konsola yazılır (MVP stub — real email xidməti sonrakı etapda).

## Etap 2 axını (sınaq ardıcıllığı)

1. Müəllim qeydiyyatdan keçir (`POST /api/auth/register/teacher`) → token + `profileStatus: "pending"`.
2. Müəllim profilini doldurur: `PATCH /api/teacher/profile` (Bearer = müəllim token), məsələn:
   ```json
   {
     "tagline": "DİM riyaziyyatı üzrə mütəxəssis",
     "bio": "10 ildir DİM-ə hazırlayıram.",
     "subjects": ["Riyaziyyat", "Fizika"],
     "experienceYears": 10,
     "introVideoUrl": "https://youtube.com/watch?v=xxxx",
     "profilePhotoUrl": "https://.../photo.jpg",
     "session1on1": true,
     "sessionGroup": true,
     "groupCapacity": 6,
     "price1on1": 25,
     "priceGroup": 12
   }
   ```
   Cavabdakı `isComplete` profilin tam dolub-dolmadığını göstərir.
3. Admin login olur, gözləyən müəllimləri görür: `GET /api/admin/teachers?status=pending` (Bearer = admin token).
4. Admin təsdiqləyir: `POST /api/admin/teachers/<id>/approve`. (Konsola email stub-u düşür.)
5. İndi həmin profilin `status`-u `approved`-dur — Etap 3-dəki public kataloq yalnız bu profilləri göstərəcək.

Qeyd: təsdiqlənmiş müəllim əsas sahəni (fənn, qiymət, sessiya tipi) dəyişsə, profil avtomatik yenidən `pending`-ə qayıdır və admin yenidən təsdiqləməlidir.

## Etap 3 — public kataloq

Login tələb etmir. Yalnız `status='approved'` müəllimləri qaytarır və **email/telefon kimi şəxsi sahələri qətiyyən göstərmir**.

`GET /api/teachers` query parametrləri:
- `subject` — məs. `Riyaziyyat` (müəllimin fənləri arasında olmalıdır)
- `sessionType` — `1on1` və ya `group`
- `minPrice`, `maxPrice` — 1-ə-1 qiymət aralığı (₼)
- `sort` — `newest` (default), `rating`, `cheapest`, `priciest`
- `hasSlots=true` — yalnız açıq (boş, gələcək) slotu olanlar
- `page`, `limit` (default 12, maks 50)

Nümunə: `GET /api/teachers?subject=Riyaziyyat&maxPrice=30&sort=cheapest&page=1`

`GET /api/teachers/:id` — yalnız approved profil görünür; pending/rejected/suspended müəllim public-də `404` qaytarır (gizlilik).

Reytinq və availability (vaxt) filtrləri sənəddə var, amma rəylər (Etap 7) və cədvəl (Etap 4) modulları gələndə qoşulacaq.

## Təhlükəsizlik qeydləri

- Parollar `bcryptjs` ilə (cost 12) hash-lanır; düz formada saxlanmır.
- Login və `forgot-password` email-in mövcudluğunu sızdırmır (eyni ümumi cavab).
- Parol sıfırlama tokenləri DB-də yalnız SHA-256 hash kimi saxlanılır; bir dəfəlikdir, 60 dəq sonra bitir.
- Bütün sorğular parametrlidir (SQL injection qoruması); profil yeniləməsində sütun adları sabit whitelist-dəndir, istifadəçi girişindən qurulmur.
- Rol əsaslı icazə: `/api/teacher/*` yalnız müəllim, `/api/admin/*` yalnız admin (401/403).
- Login/forgot/reset: 15 dəq/10 cəhd; qeydiyyat: 1 saat/20 cəhd (IP əsaslı).
- Bütün cavablarda `password_hash` heç vaxt qaytarılmır.

## Test konsolu (ən rahat yol)

Migration-dan sonra serveri qaldır və brauzerdə `http://localhost:4000/` aç. Backend sadə bir HTML konsolu verir — eyni origin olduğu üçün CORS problemi yoxdur. Üç rolu (tələbə/müəllim/admin) ayrıca saxlayır, ona görə tam axını login-i təkrarlamadan keçə bilərsən:

1. **Giriş** tabı: tələbə + müəllim qeydiyyatı; admin üçün əvvəlcə `npm run seed:admin`, sonra login.
2. **Müəllim** tabı: profili doldur → yadda saxla; slot aç (tarix/saat 1 gündən sonra qoy ki, ləğv qaydasını da sına).
3. **Admin** tabı: gözləyən müəllimi təsdiqlə.
4. **Tələbə** tabı: balans artır → müəllimləri gətir → slotlara bax → rezerv et. Sonra **Müəllim** tabında dərsi "Tamamla", **Tələbə** tabında "Rəy yaz". **Müəllim**-də qazancı hesabla → payout istə → **Admin**-də ödə.

Hər API cavabı aşağıdakı "Son cavab" panelində xam JSON kimi görünür.

## Ödəniş — Square (aktiv) / Kapital / stub

Ödəniş provayderi `.env`-dəki `PAYMENT_PROVIDER` ilə seçilir: **`square`** (indi aktiv test inteqrasiyası), `kapital` (AZ production üçün), `stub` (açarsız, birbaşa kredit).

### Square (sandbox/test) — indi istifadə et

Kart məlumatı serverə dəymir: frontend Square Web Payments SDK ilə kartı **token**ləşdirir, backend həmin token-i `POST /v2/payments` ilə **charge** edir (yönləndirmə yoxdur). `app.html`-də Balans səhifəsində kart formu avtomatik görünür.

**Sənin etməli olduqların:**
1. developer.squareup.com → giriş → **Sandbox** test application yarat.
2. Developer Console-dan götür: **Sandbox Access Token** (gizli), **Application ID** (`sandbox-sq0idb-...`, public), **Location ID** (public).
3. `.env`:
   ```
   PAYMENT_PROVIDER=square
   SQUARE_ENV=sandbox
   SQUARE_ACCESS_TOKEN=...        # gizli
   SQUARE_APP_ID=sandbox-sq0idb-...
   SQUARE_LOCATION_ID=...
   SQUARE_CURRENCY=USD            # sandbox USD; Square AZN dəstəkləmir
   ```
4. `npm run dev` → `app.html` → Balans → test kartı ilə ödə:
   **4111 1111 1111 1111**, CVV **111**, istənilən gələcək tarix, poçt **10001**.

Qeyd: Square Azərbaycanda canlı işləmir və AZN dəstəkləmir — bu, **test/sandbox** inteqrasiyasıdır. Canlı AZ ödənişi üçün `PAYMENT_PROVIDER=kapital` (kod hazırdır) istifadə olunur.

## Etap 8 — Kapital Bank ödəniş (real)

Balans artırma real **Kapital Bank TXPG** axını ilə işləyir. Rejim `.env`-dəki `PAYMENT_PROVIDER` ilə seçilir:

- `stub` (default) — bank açarı olmadan balans birbaşa kreditlənir (lokal/test; konsolda "Artır" dərhal işləyir).
- `kapital` — real axın: backend bankda order yaradır → istifadəçi bankın kart səhifəsinə yönəlir → ödənişdən sonra geri qayıdır → backend statusu **birbaşa bankdan** yoxlayıb balansı kreditləyir.

Axın (kapital rejimi): `POST /api/student/wallet/topup` `pending` topup yaradır və `{ mode:'redirect', paymentUrl }` qaytarır → frontend ora yönəldir → bank `PUBLIC_BASE_URL/api/payments/return/:id`-ə qaytarır (PUBLIC, JWT yox) → backend `FullyPaid`-i təsdiqləyib balansı kreditləyir (idempotent: `FOR UPDATE` + status yenidən yoxlanır, ikiqat kredit yoxdur). Frontend əlavə zəmanət üçün `POST /api/student/wallet/topup/:id/verify` çağıra bilər.

**Sənin etməli olduqların (açarlar):**

1. Kapital Bank-dan e-commerce merchant hesabı al → `login` + `password` (test sandbox: `TerminalSys/kapital` / `kapital123`).
2. `.env`-də doldur:
   ```
   PAYMENT_PROVIDER=kapital
   KAPITAL_LOGIN=sənin_login
   KAPITAL_PASSWORD=sənin_parol
   KAPITAL_IS_DEV=true                      # test; canlıda false
   PUBLIC_BASE_URL=http://localhost:4000    # canlıda https://api.educan.az
   ```
3. `npm install` (`@twelver313/kapital-bank` artıq asılılıqdadır).
4. Test kartları üçün `pg.kapitalbank.az/docs`-a bax. `KAPITAL_IS_DEV=true` ikən real pul getmir.

Təhlükəsizlik: balans heç vaxt müştərinin sözü ilə artmır — yalnız backend bankdan `FullyPaid` təsdiqi alandan sonra; məbləğ `wallet_topups` sətrindən götürülür; `KAPITAL_PASSWORD` yalnız `.env`-dədir (git-ə düşmür).

## İki frontend

- **`http://localhost:4000/app.html`** — özün üçün sadə, səliqəli interfeys (müəllim axtarışı, profil, rezerv, balans, dərslər, müəllim/admin panelləri). Tək sessiya (bir login).
- **`http://localhost:4000/`** — texniki test konsolu (üç rolu ayrıca saxlayır, hər API cavabını xam JSON göstərir). Sürətli sınaq üçün.

## Dərs görüşü + yazılış — TAM ƏL İLƏ (Zoom API yoxdur)

Zoom API/Server-to-Server inteqrasiyası **ləğv edilib**. Müəllim Zoom görüşünü **özü yaradır**:

- **Meeting linki:** müəllim Zoom-da görüşü açır və qoşulma linkini `PATCH /api/teacher/slots/:id/meeting` (`{ joinUrl }`) ilə slota yapışdırır. Tələbə həmin linki dərs otağında (qoşulma pəncərəsində) görür. Qrup dərsində bütün tələbələr eyni linkə qoşulur.
- **Yazılış:** müəllim Zoom-da çəkdiyi videonu `POST /api/teacher/lessons/:id/recording` ilə əl ilə əlavə edir — ya **video fayl yükləyir** (multipart sahə `recording`, `/uploads`-a düşür), ya da hazır **linki** (`{ recordingUrl }` — Zoom cloud/Drive/YouTube). Qrup dərsində eyni slotun bütün tələbələrinə tətbiq olunur. Avtomatik/stub yazılış qoyulmur.

> Prod-da böyük videoları lokal diskə yox, obyekt-storage-a (S3/R2) yığmaq, ya da yalnız `recordingUrl` linkindən istifadə etmək tövsiyə olunur (`src/middleware/upload.js` → `recordingUpload` limiti 1GB).

## Email (real, açar-hazır)

`.env` boş olanda email konsola yazılır (stub); açar əlavə edəndə real SMTP-yə keçir, kod dəyişmir.

**Email (SMTP):** istənilən SMTP (məs. öz domenin Hetzner/KonsoleH, ya da Mailgun/SendGrid SMTP). `.env`-də:
```
EMAIL_HOST=mail.educan.az
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=no-reply@educan.az
EMAIL_PASS=...
EMAIL_FROM=EduCan <no-reply@educan.az>
```
Parol sıfırlama və müəllim status bildirişləri bu kanalla gedir.

## Stub-lar (açar əlavə edəndə real işləyir)

- **Zoom:** API inteqrasiyası yoxdur — meeting linki və yazılış müəllim tərəfindən əl ilə verilir (yuxarıdakı bölmə).
- **Ödəniş:** açar yoxdursa balans birbaşa kreditlənir; `PAYMENT_PROVIDER=kapital` ilə real (yuxarıda *Etap 8*).
- **Email:** açar yoxdursa konsola yazılır; `EMAIL_*` ilə real SMTP (yuxarıda).
- **Komissiya:** `src/constants/config.js` → `COMMISSION_RATE` (0.2). Sənəddəki 20%/35% ziddiyyətini komanda təsdiqləməlidir.

## Sənə düşənlər (açarlar + deploy)

- **Kapital Bank** merchant hesabı (canlı `login`/`password`); test üçün sandbox açarı README-də.
- **SMTP** poçt hesabı (host/user/pass).
- **Deploy:** PostgreSQL (məs. managed/Hetzner), `npm run migrate`, güclü `JWT_SECRET` (`openssl rand -hex 32`), domen + HTTPS, `PUBLIC_BASE_URL` və `FRONTEND_URL`-i canlı ünvanlarla doldur.
- (İstəyə bağlı) çoxlu instans olarsa rate-limit üçün Redis store.

## Sonrakı (istəyə bağlı) təkmilləşdirmələr

- Yazılış faylları üçün obyekt-storage (S3/R2) və ya CDN.
- Bildiriş/reminder email-ləri (scheduler genişləndirilə bilər).
#   e d u c a n - b a c k e n d  
 