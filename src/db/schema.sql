-- EduCan — Auth & Users sxemi (Etap 1)
-- PostgreSQL

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid() üçün

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('student', 'teacher', 'admin');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE teacher_status AS ENUM ('pending', 'approved', 'rejected', 'suspended');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role          user_role NOT NULL,
  full_name     VARCHAR(120) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  phone         VARCHAR(30),
  region        VARCHAR(80),
  password_hash TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_role  ON users (role);

-- Müəllim profili: auth etapında yalnız təsdiq statusu üçün stub.
-- Detallı sahələr (fənn, bio, video, qiymət, cədvəl) profil etapında əlavə olunacaq.
CREATE TABLE IF NOT EXISTS teacher_profiles (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status     teacher_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Etap 2: profil sahələri. ADD COLUMN IF NOT EXISTS sayəsində həm təzə,
-- həm də mövcud DB-də təhlükəsizdir — migrate-i təkrar çağırmaq olar.
ALTER TABLE teacher_profiles
  ADD COLUMN IF NOT EXISTS profile_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS tagline           VARCHAR(160),
  ADD COLUMN IF NOT EXISTS bio               VARCHAR(500),
  ADD COLUMN IF NOT EXISTS education         TEXT,
  ADD COLUMN IF NOT EXISTS experience_years  SMALLINT,
  ADD COLUMN IF NOT EXISTS subjects          TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS intro_video_url   TEXT,
  ADD COLUMN IF NOT EXISTS session_1on1      BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS session_group     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS group_capacity    SMALLINT,
  ADD COLUMN IF NOT EXISTS price_1on1        NUMERIC(8,2) NOT NULL DEFAULT 19,
  ADD COLUMN IF NOT EXISTS price_group       NUMERIC(8,2) NOT NULL DEFAULT 9,
  ADD COLUMN IF NOT EXISTS rejection_reason  TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by       UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_teacher_status ON teacher_profiles (status);

-- Parol sıfırlama tokenləri.
-- TOKEN DÜZ FORMADA SAXLANMIR — yalnız SHA-256 hash-i saxlanılır.
-- Beləliklə DB sızsa belə tokenlər istifadəyə yararsız olur.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reset_tokens_user ON password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_reset_tokens_hash ON password_reset_tokens (token_hash);

-- ===================================================================
-- Etap 4–7: cədvəl (slots), booking, wallet, rəylər, payout
-- ===================================================================

-- Tələbə pul kisəsi (wallet) balansı. Ledger: wallet_transactions.
ALTER TABLE users ADD COLUMN IF NOT EXISTS balance NUMERIC(10,2) NOT NULL DEFAULT 0;

DO $$ BEGIN CREATE TYPE session_type    AS ENUM ('1on1','group');               EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE booking_status  AS ENUM ('booked','completed','cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE payout_status   AS ENUM ('requested','paid');            EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Müəllimin açdığı konkret vaxt slotları (MVP: təkrarlanan həftəlik şablon yox,
-- konkret tarix/saat — booking və race-condition məntiqini sadə saxlayır).
CREATE TABLE IF NOT EXISTS slots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at    TIMESTAMPTZ NOT NULL,
  duration_min SMALLINT NOT NULL DEFAULT 60,
  session_type session_type NOT NULL DEFAULT '1on1',
  capacity     SMALLINT NOT NULL DEFAULT 1,
  price        NUMERIC(8,2) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (teacher_id, starts_at)
);
CREATE INDEX IF NOT EXISTS idx_slots_teacher ON slots (teacher_id, starts_at);

CREATE TABLE IF NOT EXISTS bookings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id       UUID NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teacher_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_type  session_type NOT NULL,
  price         NUMERIC(8,2) NOT NULL,
  starts_at     TIMESTAMPTZ NOT NULL,
  duration_min  SMALLINT NOT NULL,
  status        booking_status NOT NULL DEFAULT 'booked',
  zoom_url      TEXT,
  recording_url TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at  TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_bookings_student ON bookings (student_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_teacher ON bookings (teacher_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_slot    ON bookings (slot_id);
-- Bir tələbə eyni slota yalnız bir aktiv booking edə bilər.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_booking
  ON bookings (slot_id, student_id) WHERE status = 'booked';

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount        NUMERIC(10,2) NOT NULL,   -- + topup/refund, - lesson_payment
  type          VARCHAR(30) NOT NULL,     -- topup|lesson_payment|refund
  description   TEXT,
  balance_after NUMERIC(10,2) NOT NULL,
  booking_id    UUID REFERENCES bookings(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallet_transactions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reviews (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating     SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reviews_teacher ON reviews (teacher_id);

CREATE TABLE IF NOT EXISTS payouts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount       NUMERIC(10,2) NOT NULL,
  status       payout_status NOT NULL DEFAULT 'requested',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at      TIMESTAMPTZ,
  processed_by UUID REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_payouts_teacher ON payouts (teacher_id);

-- ===================================================================
-- Etap 8: real ödəniş (Kapital Bank TXPG) — balans artırma sifarişləri
-- ===================================================================
CREATE TABLE IF NOT EXISTS wallet_topups (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount            NUMERIC(10,2) NOT NULL,
  status            VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|paid|failed
  provider          VARCHAR(20) NOT NULL DEFAULT 'kapital',
  provider_order_id TEXT,        -- bankın order.id
  provider_password TEXT,        -- bankın order.password (status/refund üçün)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_topups_user ON wallet_topups (user_id, created_at DESC);

-- Etap (Zoom): müəllim üçün ayrıca host linki (start_url)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS host_url TEXT;

-- ===================================================================
-- Müəllim (19–27) və Tələbə (10–18) səhifələri: fənn, bank, foto, bildiriş
-- ===================================================================
ALTER TABLE slots            ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE bookings         ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE teacher_profiles ADD COLUMN IF NOT EXISTS bank_account TEXT;
-- foto və bildiriş hər rol üçün users-də (tələbə foto/settings + müəllim bildiriş)
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url    TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_email BOOLEAN NOT NULL DEFAULT TRUE;

-- Admin (28–33): dərs ləğv səbəbi (tələbə banı üçün mövcud users.is_active istifadə olunur)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

-- ===================================================================
-- Zoom v2: meeting artıq SLOT-a aiddir (booking-ə yox).
-- Müəllim slot yaradanda link YA əl ilə yapışdırılır, YA da S2S API ilə
-- generasiya olunur. Bütün tələbələr (xüsusən qrup) EYNİ meeting-ə qoşulur.
-- ===================================================================
ALTER TABLE slots
  ADD COLUMN IF NOT EXISTS zoom_join_url   TEXT,   -- tələbələrin qoşulduğu link
  ADD COLUMN IF NOT EXISTS zoom_host_url   TEXT,   -- müəllimin start linki (varsa)
  ADD COLUMN IF NOT EXISTS zoom_meeting_id TEXT;   -- recording webhook-u ilə uyğunlaşdırmaq üçün

CREATE INDEX IF NOT EXISTS idx_slots_meeting ON slots (zoom_meeting_id);

-- ===================================================================
-- Webhook idempotency: hər webhook event-i yalnız BİR DƏFƏ emal olunsun.
-- Dodo "webhook-id", Zoom isə öz event id-sini göndərir. Eyni id təkrar
-- gəlsə (provider retry edir), ikinci dəfə emal etmirik.
-- ===================================================================
CREATE TABLE IF NOT EXISTS processed_webhooks (
  id           TEXT PRIMARY KEY,          -- provider event id (webhook-id)
  source       VARCHAR(20) NOT NULL,      -- 'dodo' | 'zoom'
  event_type   TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dodo ödənişləri də wallet_topups cədvəlindən istifadə edir:
--   provider          = 'dodo'
--   provider_order_id = Dodo payment_id (pay_...)
-- Əlavə sütun lazım deyil — mövcud sxem kifayətdir.

-- ===================================================================
-- Auth v2: email OTP təsdiqi + Google ilə giriş
-- ===================================================================
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auth_provider  VARCHAR(20) NOT NULL DEFAULT 'password'; -- 'password' | 'google'

-- 6 rəqəmli OTP kodları (kod açıq saxlanılmır — yalnız sha256 hash).
-- Bir user üçün eyni anda bir aktiv kod (user_id UNIQUE → upsert).
CREATE TABLE IF NOT EXISTS email_otps (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INT NOT NULL DEFAULT 0,   -- səhv cəhdlər; limit aşılanda kod ləğv olunur
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
