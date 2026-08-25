import { createClient } from "@supabase/supabase-js";

/**
 * Publishable-key client for the read-only public dashboard.
 * Relies on the "public read" RLS policies — never given write access.
 */
export function createPublicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY env vars"
    );
  }

  return createClient(url, publishableKey);
}
