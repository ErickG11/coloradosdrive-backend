import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';

// RF-03/RNF-05: notificaciones en tiempo real vía Broadcast, no
// postgres_changes. RLS ya está activo en toda tabla de dominio (ver
// migrations/009_enable_rls.sql), pero postgres_changes seguiría sin ser
// seguro para este caso: expondría cambios de fila de practice_slots sin
// filtrar por quién debería verlos. Con Broadcast, el backend decide
// explícitamente qué payload ya sanitizado envía y a qué canal (ver
// docs/adr/007). El canal se marca `private: true` (igual que en
// useRealtimeChannel.ts del frontend) porque los topics de este canal
// tienen su propia autorización sobre realtime.messages (ver
// migrations/011_realtime_broadcast_authorization.sql) — sin esto,
// cualquiera con la anon key que adivinara el nombre del canal podía
// suscribirse sin ninguna verificación.
//
// Usa httpSend (REST, sin necesidad de mantener un WebSocket suscrito)
// en vez de send()+subscribe(): más simple y sin el overhead del
// handshake de suscripción para un envío puntual y ocasional - encaja
// mejor con el límite de latencia de RNF-05 (≤5s). El envío en sí usa
// supabaseAdmin (service_role), que de todas formas ignora RLS.
export class RealtimeService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async broadcast(
    channelName: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const channel = this.supabase.channel(channelName, { config: { private: true } });
    try {
      const result = await channel.httpSend(event, payload);
      if (!result.success) {
        throw new Error(
          `Broadcast a "${channelName}" falló (status ${String(result.status)}): ${result.error}`,
        );
      }
    } finally {
      await this.supabase.removeChannel(channel);
    }
  }
}
