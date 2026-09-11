import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../config/database.types';

// RF-03/RNF-05: notificaciones en tiempo real vía Broadcast, no
// postgres_changes. Este proyecto no usa Row Level Security en ninguna
// tabla (supabaseAdmin, el único cliente que escribe, la ignora por
// diseño - ver config/supabase.ts), así que suscribirse a cambios crudos
// de fila expondría cualquier práctica de cualquier cohorte a cualquier
// suscriptor. Con Broadcast, el backend decide explícitamente qué
// payload ya sanitizado envía y a qué canal (ver docs/adr/007).
//
// Usa httpSend (REST, sin necesidad de mantener un WebSocket suscrito)
// en vez de send()+subscribe(): más simple y sin el overhead del
// handshake de suscripción para un envío puntual y ocasional - encaja
// mejor con el límite de latencia de RNF-05 (≤5s).
export class RealtimeService {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  async broadcast(
    channelName: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const channel = this.supabase.channel(channelName);
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
