-- P4: Add scopes and lookup_prefix to api_tokens for MCP endpoint
ALTER TABLE "api_tokens" ADD COLUMN "lookup_prefix" text NOT NULL DEFAULT '';
ALTER TABLE "api_tokens" ADD COLUMN "scopes" text NOT NULL DEFAULT 'read';
-- Remove the default on lookup_prefix after backfill (new tokens always set it)
