import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import { StudentPendingDocumentsService } from '../../src/services/studentPendingDocuments.service';
import { createSupabaseFromMock } from '../helpers/supabaseMock';
it('cuenta días civiles y documentos físicos, con exención desde 65', async () => {
 const from = createSupabaseFromMock([
  {data:[{id:'e',cohort_id:'c',status:'activo'}],error:null},
  {data:[{enrollment_id:'e',tipo:'cedula',estado:'entregado'}],error:null},
  {data:{fecha_nacimiento:'1960-01-01'},error:null},
  {data:[{fecha_fin_matricula:'2026-11-10'}],error:null},
 ]);
 const result = await new StudentPendingDocumentsService({from} as unknown as SupabaseClient<Database>).get('s',new Date('2026-11-06T04:59:00Z'));
 expect(result).toEqual({documentosPendientes:['tipo_sangre','titulo_bachiller'],fechaLimite:'2026-11-10',diasRestantes:5,cohortePendiente:false});
});
it('sin cohorte informa pendientes sin inventar fecha límite', async () => {
 const from=createSupabaseFromMock([{data:[{id:'e',cohort_id:null,status:'pendiente_cohorte'}],error:null},{data:[],error:null},{data:{fecha_nacimiento:'2000-01-01'},error:null}]);
 const result=await new StudentPendingDocumentsService({from} as unknown as SupabaseClient<Database>).get('s');
 expect(result).toMatchObject({cohortePendiente:true,fechaLimite:null,diasRestantes:null});
 expect(result.documentosPendientes).toHaveLength(4);
});
