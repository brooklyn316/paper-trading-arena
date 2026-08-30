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

  return createClient(url, publishableKey, {
    // Next.js caches fetch() responses by URL by default — we already got
    // burned by exactly this with the Alpaca client (see AlpacaClient's
    // request()), where a dashboard-style repeated call silently kept
    // returning its first response forever. supabase-js issues its queries
    // via fetch() too, so the dashboard would show frozen data the same
    // way without this override.
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
}
