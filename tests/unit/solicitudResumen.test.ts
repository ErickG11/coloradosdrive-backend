import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import type { AccountService } from '../../src/services/account.service';
import type { CohortAssignmentService } from '../../src/services/cohortAssignment.service';
import type { EmailService } from '../../src/services/email.service';
import { SolicitudService } from '../../src/services/solicitud.service';
import { createChain } from '../helpers/supabaseMock';
function harness(){const chain=createChain({data:[],error:null,count:0}),from=jest.fn().mockReturnValue(chain),rpc=jest.fn().mockResolvedValue({data:{pendientes:3,documentosPorRevisar:5},error:null});return {chain,from,rpc,service:new SolicitudService({from,rpc} as unknown as SupabaseClient<Database>,{} as EmailService,{} as AccountService,{} as CohortAssignmentService)};}
it('el resumen devuelve conteos sin descargar expedientes ni documentos',async()=>{const h=harness();await expect(h.service.resumen()).resolves.toEqual({pendientes:3,documentosPorRevisar:5});expect(h.from).not.toHaveBeenCalled();});
it('ordena pendientes por envío y decididas por revisión, con id estable al paginar',async()=>{const h=harness();await h.service.listarParaAdmin(undefined,2,20);expect(h.from).toHaveBeenCalledWith('solicitudes_admin');expect(h.chain.order.mock.calls).toEqual([['orden_grupo'],['pendiente_desde',{ascending:true,nullsFirst:false}],['decidida_at',{ascending:false,nullsFirst:false}],['id']]);expect(h.chain.range).toHaveBeenCalledWith(20,39);expect(h.chain.not).toHaveBeenCalledWith('enviada_at','is',null);});
it('filtra solo expedientes con documentos revisables',async()=>{const h=harness();await h.service.listarParaAdmin('con_documentos_por_revisar');expect(h.chain.gt).toHaveBeenCalledWith('documentos_por_revisar',0);expect(h.chain.in).toHaveBeenCalledWith('estado',['pendiente_revision','aprobada']);});
