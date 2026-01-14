-- Supabase SQL for `invoices` and `purchases` tables

-- Enable the extension for gen_random_uuid (if not already enabled)
-- You may need superuser privileges to enable extensions in some setups
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Invoices table
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name text,
  client_name text,
  items jsonb,
  total numeric(12,2),
  created_at timestamptz DEFAULT now()
);

-- Purchases table
CREATE TABLE IF NOT EXISTS purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text UNIQUE,
  customer_email text,
  invoices integer,
  amount_total bigint,
  created_at timestamptz DEFAULT now()
);
