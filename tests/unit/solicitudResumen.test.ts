import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import type { AccountService } from '../../src/services/account.service';
import type { CohortAssignmentService } from '../../src/services/cohortAssignment.service';
import type { EmailService } from '../../src/services/email.service';
import { SolicitudService } from '../../src/services/solicitud.service';
import { SolicitudAdminService } from '../../src/services/solicitudAdmin.service';
import { createChain } from '../helpers/supabaseMock';
function harness() {
  const chain = createChain({ data: [], error: null, count: 0 }),
    from = jest.fn().mockReturnValue(chain),
    rpc = jest
      .fn()
      .mockResolvedValue({
        data: {
          pendientes: 3,
          devueltas: 1,
          conMasDe48h: 2,
          inscripcionesAbiertas: true,
          contadoresHoy: { codigos: 200, subidas: 32, solicitudes: 120 },
        },
        error: null,
      });
  return {
    chain,
    from,
    rpc,
    service: new SolicitudService(
      { from, rpc } as unknown as SupabaseClient<Database>,
      {} as EmailService,
      {} as AccountService,
      {} as CohortAssignmentService,
    ),
  };
}
it('el resumen devuelve conteos sin descargar expedientes ni documentos', async () => {
  const h = harness();
  const result = await h.service.resumen();
  expect(result).toMatchObject({
    pendientes: 3,
    devueltas: 1,
    conMasDe48h: 2,
    inscripcionesAbiertas: true,
  });
  expect(result.alertas).toEqual(['codigos', 'subidas', 'solicitudes']);
  expect(result).not.toHaveProperty('documentosPorRevisar');
  expect(h.from).not.toHaveBeenCalled();
});
// El orden de la lista (enviadas más antiguas, devueltas, decididas recientes, id estable) vive
// ahora en la función SQL listar_solicitudes_admin; el servicio solo le pasa filtro y página.
it('la lista delega en listar_solicitudes_admin con estado, búsqueda saneada y página', async () => {
  const lista = { items: [], total: 0, page: 2, pageSize: 20 };
  const rpc = jest.fn().mockResolvedValue({ data: lista, error: null });
  const service = new SolicitudAdminService({ rpc } as unknown as SupabaseClient<Database>);
  expect(await service.listar('enviada', '  Ana  ', 2, 20)).toBe(lista);
  expect(rpc).toHaveBeenCalledWith('listar_solicitudes_admin', {
    p_estado: 'enviada',
    p_q: 'Ana',
    p_page: 2,
    p_size: 20,
  });
});
it('sin filtro ni búsqueda envía nulos y falla con 503 si la consulta falla', async () => {
  const rpc = jest
    .fn()
    .mockResolvedValueOnce({ data: { items: [] }, error: null })
    .mockResolvedValueOnce({ data: null, error: { code: 'XX000' } });
  const service = new SolicitudAdminService({ rpc } as unknown as SupabaseClient<Database>);
  await service.listar(undefined, '', 1, 20);
  expect(rpc).toHaveBeenLastCalledWith('listar_solicitudes_admin', {
    p_estado: null,
    p_q: null,
    p_page: 1,
    p_size: 20,
  });
  await expect(service.listar(undefined, '', 1, 20)).rejects.toMatchObject({ statusCode: 503 });
});
