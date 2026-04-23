-- Baseline extensions for the myreport database.
-- Runs once at first container start.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";      -- gen_random_uuid, digest/hmac
CREATE EXTENSION IF NOT EXISTS "citext";        -- case-insensitive text for emails
CREATE EXTENSION IF NOT EXISTS "pg_trgm";       -- fuzzy search on names / clients
