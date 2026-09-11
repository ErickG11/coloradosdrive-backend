import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../../src/config/database.types';
import { RealtimeService } from '../../src/services/realtime.service';

function buildSupabaseMock(
  httpSendResult: { success: true } | { success: false; status: number; error: string },
) {
  const httpSend = jest.fn().mockResolvedValue(httpSendResult);
  const channel = { httpSend };
  const channelFn = jest.fn().mockReturnValue(channel);
  const removeChannel = jest.fn().mockResolvedValue(undefined);

  return {
    supabase: { channel: channelFn, removeChannel } as unknown as SupabaseClient<Database>,
    channelFn,
    httpSend,
    removeChannel,
    channel,
  };
}

describe('RealtimeService.broadcast', () => {
  it('abre el canal, envía el evento por REST (httpSend) y lo remueve al terminar', async () => {
    const { supabase, channelFn, httpSend, removeChannel, channel } = buildSupabaseMock({
      success: true,
    });
    const service = new RealtimeService(supabase);

    await service.broadcast('cohort-1-practice-slots', 'slot-released', { slotId: 'slot-1' });

    expect(channelFn).toHaveBeenCalledWith('cohort-1-practice-slots');
    expect(httpSend).toHaveBeenCalledWith('slot-released', { slotId: 'slot-1' });
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });

  it('lanza un error si el broadcast falla, pero igual remueve el canal', async () => {
    const { supabase, removeChannel, channel } = buildSupabaseMock({
      success: false,
      status: 500,
      error: 'boom',
    });
    const service = new RealtimeService(supabase);

    await expect(service.broadcast('canal', 'evento', {})).rejects.toThrow(/falló/);
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });
});
