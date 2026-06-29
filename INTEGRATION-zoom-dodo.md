# EduCan — Zoom v2 + Dodo Payments inteqrasiyası

Bu sənəd bu mərhələdə dəyişən hər şeyi və necə test edəcəyini izah edir.

## 1. Zoom: meeting artıq SESSİYAYA (slota) aiddir

Əvvəl hər booking üçün ayrıca meeting yaradılırdı (qrup dərsi üçün səhv — hər
tələbə fərqli meeting-ə düşürdü). İndi müəllim meeting-i bir dəfə sessiyaya
bağlayır, bütün tələbələr eyni linkə qoşulur.

**Yeni / dəyişən endpoint-lər**

| Metod | Yol | Açıqlama |
|------|-----|----------|
| POST | `/api/teacher/slots` | `joinUrl` (yapışdır) və ya `generateZoom:true` qəbul edir |
| PATCH | `/api/teacher/slots/:id/meeting` | Mövcud slota meeting bağla/yenilə |
| GET | `/api/student/lessons/:id` | `zoomUrl` artıq slotdan gəlir; meeting yoxdursa aydın mesaj |
| GET | `/api/teacher/lessons/:id/room` | Host linki slotdan gəlir |

`POST /api/teacher/slots` body nümunələri:
```jsonc
{ "startsAt":"2026-07-01T15:00:00+04:00", "sessionType":"group", "generateZoom":true }
// və ya
{ "startsAt":"...", "sessionType":"1on1", "joinUrl":"https://zoom.us/j/123..." }
```

`createBooking` artıq meeting AÇMIR — yalnız yeri rezerv edir.

## 2. Recording (yazılış)

- **Avtomatik başlayır.** Meeting yaradılanda `settings.auto_recording: "cloud"`
  qoyulur; host qoşulan kimi buludda yazılır. (Əl ilə variant: müəllim Zoom-da
  Record düyməsinə basır — daha çox unudulma riski.)
- **Zoom Cloud-da saxlanılır.** Bizim DB yalnız video URL-ini saxlayır. (İstəsən
  sonra Hetzner-ə yükləyib öz saxlamana keçə bilərsən — xərc/retention üçün.)
- **Dərsə necə bağlanır:** `recording.completed` webhook-u gəlir → `meeting_id`
  ilə slot tapılır → həmin slotun bütün booking-lərinə `recording_url` yazılır.
  Buna görə `slots.zoom_meeting_id` saxlanılır.
- **API-lər:** S2S OAuth token → `POST /users/me/meetings` (auto_recording ilə)
  → `recording.completed` webhook (fallback: `GET /meetings/{id}/recordings`).

Zoom panelində: Event Subscriptions → `recording.completed` → URL:
`{PUBLIC_BASE_URL}/api/payments/zoom/webhook`. Secret Token-i
`ZOOM_WEBHOOK_SECRET_TOKEN`-ə yaz. (Endpoint URL validation və imza yoxlaması
hazırdır.)

## 3. Dodo Payments (sandbox)

Wallet top-up axınına yeni provider kimi əlavə olundu. Uğurlu ödənişdən sonra
balans kreditlənir = istifadəçiyə kursa/dərsə giriş açılır.

**Axın:** `topup → Dodo checkout (redirect) → webhook (payment.succeeded) →
balans kreditlənir`.

`.env`:
```
PAYMENT_PROVIDER=dodo
DODO_ENV=test
DODO_API_KEY=test_...
DODO_WEBHOOK_SECRET=whsec_...
DODO_PRODUCT_ID=pdt_...        # Dashboard → Products
DODO_PWYW=false               # məhsul "Pay What You Want"-dursa true
```

Webhook URL (Dodo Dashboard → Developer → Webhooks):
`{PUBLIC_BASE_URL}/api/payments/dodo/webhook` — `payment.succeeded` event-i seç.

**Təhlükəsizlik:** webhook imzası Standard Webhooks spesifikasiyası ilə
`node:crypto`-da yoxlanılır (rəsmi `standardwebhooks` kitabxanası ilə uyğunluğu
test edilib). İmza RAW gövdə üzərində yoxlanır — buna görə bu route
`express.json()`-dan əvvəl `express.raw()` ilə bağlanıb. Hər webhook bir dəfə
emal olunur (`processed_webhooks`), balans kreditləmə idempotentdir.

**Lokal test (tunelsiz):** webhook localhost-a çatmaya bilər. Bu halda frontend
`POST /api/student/wallet/topup/:id/verify` çağırır — bu, statusu birbaşa
Dodo API-dən oxuyub balansı kreditləyir (fallback). Production-da ngrok/Cloudflare
Tunnel ilə real webhook işlədir.

## 4. Frontend-də test (backend olmadan)

`public/zoom-pay-demo.html` — açıb brauzerdə işlət. **MOCK rejimi** açıq olanda
backend ümumiyyətlə lazım deyil:

1. Müəllim sessiya yaradır (mock meeting ID generasiya olunur və ya link yapışdır).
2. Tələbə “Join Meeting” düyməsi ilə linkə qoşulur.
3. Dodo ödəniş axını: checkout → (simulyasiya) ödəniş səhifəsi → “webhook (paid)”
   düyməsi imzalı bildirişi təqlid edir → balans kreditlənir → “kursa giriş verildi”.

MOCK-u söndürəndə eyni düymələr real backend endpoint-lərinə gedir (API URL +
JWT daxil et). Beləliklə backend hazır olanda kod dəyişmədən real rejimə keçirsən.

Əsas SPA (`public/app.html`) də işləyir: Dodo `redirect` axını mövcud top-up
məntiqini təkrar istifadə edir; müəllim cədvəlində `App.setMeeting(slotId)` əlavə
olundu.

## 5. Migrasiya

```
npm run migrate
```
`schema.sql` idempotentdir (ADD COLUMN IF NOT EXISTS). Əlavə olunanlar:
`slots.zoom_join_url / zoom_host_url / zoom_meeting_id`, `processed_webhooks`.
