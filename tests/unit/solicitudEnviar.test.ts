import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import type { AccountService } from '../../src/services/account.service';
import type { CohortAssignmentService } from '../../src/services/cohortAssignment.service';
import type { EmailService } from '../../src/services/email.service';
import { SolicitudService } from '../../src/services/solicitud.service';
import { createSupabaseFromMock } from '../helpers/supabaseMock';
const row={id:'s',correo_verificado:true,enviada_at:null,estado:'pendiente_revision',cedula:'1710034065',nombre_completo:'Ana Torres',fecha_nacimiento:'1990-01-01',solicitada_at:'2026-10-01'};
function harness(overrides={},consent:unknown={acepto_tratamiento:true,declara_veracidad:true},docs:unknown[]=[{tipo_documento:'cedula'},{tipo_documento:'titulo_bachiller'}]){
 const from=createSupabaseFromMock([{data:{...row,...overrides},error:null},{data:consent,error:null},{data:docs,error:null}]);
 const result={id:'s',estado:'enviada',enviadaAt:'2026-11-03T12:00:00Z'};const rpc=jest.fn().mockResolvedValue({data:result,error:null});
 const service=new SolicitudService({from,rpc} as unknown as SupabaseClient<Database>,{} as EmailService,{} as AccountService,{} as CohortAssignmentService);
 return {from,rpc,service,result};
}
it.each([['cedula'],['titulo_bachiller'],['cedula','titulo_bachiller']])('rechaza faltantes %j antes de persistir envío',async(...faltantes)=>{
 const h=harness({},undefined,['cedula','titulo_bachiller'].filter(tipo=>!faltantes.includes(tipo)).map(tipo_documento=>({tipo_documento})));
 await expect(h.service.enviar('s')).rejects.toMatchObject({statusCode:400,code:'SOLICITUD_INCOMPLETA',detalles:{faltantes}});expect(h.rpc).not.toHaveBeenCalled();
});
it('envía con ambos documentos, incluso si uno está rechazado',async()=>{const h=harness({},undefined,[{tipo_documento:'cedula',estado:'rechazado'},{tipo_documento:'titulo_bachiller',estado:'recibido'}]);await expect(h.service.enviar('s')).resolves.toEqual(h.result);expect(h.rpc).toHaveBeenCalledTimes(1);});
it('un reenvío conserva exactamente enviadaAt sin volver a escribir',async()=>{const h=harness({enviada_at:'2026-11-01T12:00:00Z'});await expect(h.service.enviar('s')).resolves.toEqual({id:'s',estado:'enviada',enviadaAt:'2026-11-01T12:00:00Z'});expect(h.rpc).not.toHaveBeenCalled();});
it.each([
 [{correo_verificado:false},null,'CORREO_NO_VERIFICADO'],[{},null,'CONSENTIMIENTO_REQUERIDO'],[{cedula:null},undefined,'DATOS_REQUERIDOS'],[{fecha_nacimiento:'2010-11-03'},undefined,'REPRESENTANTE_REQUERIDO'],
])('valida prerequisitos en orden %j',async(overrides,consent,code)=>{const h=harness(overrides,consent);await expect(h.service.enviar('s')).rejects.toMatchObject({code});expect(h.rpc).not.toHaveBeenCalled();});
