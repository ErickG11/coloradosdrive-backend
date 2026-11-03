import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import { SolicitudCleanupService } from '../../src/services/solicitudCleanup.service';
import { SolicitudDeletionService } from '../../src/services/solicitudDeletion.service';
import { createSupabaseFromMock } from '../helpers/supabaseMock';
afterEach(() => jest.restoreAllMocks());
it('purga rechazadas a N días y conserva aprobadas fuera de la consulta', async () => {
 const from = createSupabaseFromMock([{ data: [
  { id: 'vieja', estado: 'rechazada', created_at: '2026-01-01', reviewed_at: '2026-01-02' },
  { id: 'reciente', estado: 'rechazada', created_at: '2026-01-01', reviewed_at: '2026-02-09' },
 ], error: null }]);
 const remove = jest.spyOn(SolicitudDeletionService.prototype,'remove').mockResolvedValue(true);
 expect(await new SolicitudCleanupService({ from } as unknown as SupabaseClient<Database>,30).purgeAbandoned(new Date('2026-02-10'))).toBe(1);
 expect(remove).toHaveBeenCalledWith('vieja',null,'purga_retencion',false);
});
it('mantiene la regla de siete días para borradores incluso con documentos', async () => {
 const from = createSupabaseFromMock([{ data: [{ id:'pendiente',estado:'pendiente_revision',created_at:'2026-02-01',reviewed_at:null }],error:null }]);
 const remove = jest.spyOn(SolicitudDeletionService.prototype,'remove').mockResolvedValue(false);
 expect(await new SolicitudCleanupService({ from } as unknown as SupabaseClient<Database>).purgeAbandoned(new Date('2026-02-10'))).toBe(0);
 expect(remove).toHaveBeenCalledWith('pendiente',null,'purga_retencion',false);
});
it('no toca una aprobación en curso',async () => {
 const from = createSupabaseFromMock([{data:[{id:'ocupada',estado:'pendiente_revision',created_at:'2026-01-01',reviewed_at:'2026-02-10'}],error:null}]);
 const remove=jest.spyOn(SolicitudDeletionService.prototype,'remove');
 expect(await new SolicitudCleanupService({from} as unknown as SupabaseClient<Database>).purgeAbandoned(new Date('2026-02-10'))).toBe(0);
 expect(remove).not.toHaveBeenCalled();
});

it('conserva enviadas y no adelanta los siete días de borrador aunque N sea menor',async()=>{const from=createSupabaseFromMock([{data:[{id:'enviada',estado:'pendiente_revision',enviada_at:'2026-01-01',created_at:'2026-01-01',reviewed_at:null},{id:'borrador',estado:'pendiente_revision',enviada_at:null,created_at:'2026-02-05',reviewed_at:null}],error:null}]);const remove=jest.spyOn(SolicitudDeletionService.prototype,'remove').mockResolvedValue(true);expect(await new SolicitudCleanupService({from} as unknown as SupabaseClient<Database>,1).purgeAbandoned(new Date('2026-02-10'))).toBe(0);expect(remove).not.toHaveBeenCalled();});
