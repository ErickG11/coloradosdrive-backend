import { createClient } from '@supabase/supabase-js';

import type { Database } from './database.types';
import { env } from './env';

/**
 * Privileged client: uses the service role key, bypasses Row Level
 * Security. Reserved for backend-only operations (services layer).
 * Never expose this client or its key to the frontend.
 */
export const supabaseAdmin = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

/**
 * Unprivileged client: uses the public anon key, subject to Row Level
 * Security. Mirrors what the frontend uses, for parity in server-side
 * flows that must respect a specific user's RLS policies.
 */
export const supabaseAnon = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
