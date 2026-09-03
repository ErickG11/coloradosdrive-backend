import { createClient, type WebSocketLikeConstructor } from '@supabase/supabase-js';
import WebSocket from 'ws';

import type { Database } from './database.types';
import { env } from './env';

// supabase-js construye su cliente de Realtime de forma eager al llamar a
// createClient(), y este necesita un WebSocket. Node solo lo trae nativo
// desde la versión 22 (ver @supabase/realtime-js/websocket-factory.ts); en
// Node 18 LTS (el mandado para este proyecto) createClient() truena en el
// import si no se le pasa un transport explícito. `ws` funciona en
// cualquier versión de Node, así que se usa siempre, sin detección de
// entorno. El cast es porque los tipos de `ws` no calzan 1:1 con
// WebSocketLikeConstructor, pero implementa la misma API en tiempo real.
const realtimeOptions = { transport: WebSocket as unknown as WebSocketLikeConstructor };

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
    realtime: realtimeOptions,
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
  realtime: realtimeOptions,
});
