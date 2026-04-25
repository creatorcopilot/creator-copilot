-- CREATOR COPILOT — Database Setup
-- Go to Supabase → SQL Editor → paste this entire file → click Run

-- ── CLIENTS TABLE ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  phone TEXT,
  tier TEXT CHECK (tier IN ('demo', 'tier1_monthly', 'tier1_annual', 'tier2_monthly', 'tier2_annual')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'paused')),

  -- Profile data
  platforms JSONB,
  client_type TEXT,
  stage TEXT,
  goal TEXT,
  niche TEXT,
  category TEXT,
  content_style TEXT,
  differentiator TEXT,
  link TEXT,
  brand_experience TEXT,
  brand_wishlist TEXT,
  off_limits TEXT,
  month3_win TEXT,

  -- Demographic builder data
  demo_complete BOOLEAN DEFAULT FALSE,
  demo_answers JSONB,
  demo_report JSONB,

  -- Generated content
  creator_personality TEXT,
  content_fingerprint TEXT,
  competitive_position TEXT,
  niche_intelligence TEXT,
  micro_audience TEXT,

  -- Delivery tracking
  last_delivery TIMESTAMP WITH TIME ZONE,
  delivery_count INTEGER DEFAULT 0,
  next_delivery TIMESTAMP WITH TIME ZONE
);

-- ── PITCH HISTORY TABLE ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pitch_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  client_email TEXT NOT NULL,
  brand_name TEXT NOT NULL,
  pitch_email TEXT,
  follow_up_1_sent BOOLEAN DEFAULT FALSE,
  follow_up_2_sent BOOLEAN DEFAULT FALSE,
  follow_up_3_sent BOOLEAN DEFAULT FALSE,
  response_received BOOLEAN DEFAULT FALSE,
  deal_closed BOOLEAN DEFAULT FALSE,
  cooldown_until TIMESTAMP WITH TIME ZONE
);

-- ── WEEKLY DELIVERIES TABLE ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deliveries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  client_email TEXT NOT NULL,
  week_number INTEGER,
  scripts JSONB,
  brand_report JSONB,
  pitch_email TEXT,
  selected_brand TEXT,
  delivered_at TIMESTAMP WITH TIME ZONE
);

-- ── INDEXES ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_tier ON clients(tier);
CREATE INDEX IF NOT EXISTS idx_pitch_history_client ON pitch_history(client_id);
CREATE INDEX IF NOT EXISTS idx_pitch_history_cooldown ON pitch_history(cooldown_until);
CREATE INDEX IF NOT EXISTS idx_deliveries_client ON deliveries(client_id);

-- ── ROW LEVEL SECURITY ─────────────────────────────────────────────
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitch_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (backend functions use service role key)
CREATE POLICY "Service role full access on clients"
  ON clients FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on pitch_history"
  ON pitch_history FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on deliveries"
  ON deliveries FOR ALL
  USING (auth.role() = 'service_role');

SELECT 'Database setup complete!' as status;
