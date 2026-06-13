-- ============================================================================
-- Predicia — cheat-proof leaderboard setup
-- Run PART 1 now. Run PART 2 only AFTER the new game is deployed and tested.
-- Supabase dashboard -> SQL Editor -> paste -> Run.
-- ============================================================================

-- ---------- PART 1 (run now) ----------
-- The server-owned accounts table. The public/anon key gets NO access at all
-- (RLS is on with zero policies); only the service-role key used by the server
-- functions can read or write it. That key never ships to the browser.
create table if not exists accounts (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text unique not null,          -- sha256 of the player's secret pass
  username    text not null,
  month       text not null,                 -- e.g. "2026-06"
  cash        numeric not null default 1000,
  holdings    jsonb   not null default '{}'::jsonb,
  value       numeric not null default 1000,
  updated_at  timestamptz not null default now()
);

alter table accounts enable row level security;
-- No policies created on purpose: anon can't touch it; service_role bypasses RLS.

create index if not exists accounts_month_value_idx on accounts (month, value desc);


-- ---------- PART 2 (run ONLY after the new game works) ----------
-- Lock the old public tables to READ-ONLY for the anon key, so nobody can edit
-- the old leaderboard or poison the cached prices. The server (service-role)
-- still writes prices via /api/refresh-histories.
--
-- Uncomment and run these once you've confirmed buying/selling works:
--
-- revoke insert, update, delete on players   from anon;
-- revoke insert, update, delete on histories from anon;
