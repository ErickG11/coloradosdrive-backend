import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/config/database.types';
import type { AccountService } from '../../src/services/account.service';
import type { CohortAssignmentService } from '../../src/services/cohortAssignment.service';
import type { EmailService } from '../../src/services/email.service';
import { SolicitudService } from '../../src/services/solicitud.service';
import { SolicitudPrivacyService } from '../../src/services/solicitudPrivacy.service';
import { createChain, createSupabaseFromMock } from '../helpers/supabaseMock';
it.each(['pendiente_revision','aprobada','rechazada'])('verifica una solicitud %s sin cambiar sus datos ni su curso',async estado=>{
 const update=createChain({data:null,error:null});const from=jest.fn().mockReturnValueOnce(createChain({data:{id:'s',course_id:'original',estado,student_id:estado==='aprobada'?'u':null,enviada_at:'2026-10-01'},error:null})).mockReturnValueOnce(createChain({data:{id:'original'},error:null})).mockReturnValueOnce(update);
 const rpc=jest.fn().mockResolvedValue({data:false,error:null}),email={sendVerificationCodeEmail:jest.fn().mockResolvedValue(undefined)};
 const service=new SolicitudService({from,rpc} as unknown as SupabaseClient<Database>,email as unknown as EmailService,{} as AccountService,{} as CohortAssignmentService);
 await service.verificarCorreo(' ANA@example.com ','otro');expect(email.sendVerificationCodeEmail).toHaveBeenCalled();const fields=update.update.mock.calls[0][0] as object;expect(fields).not.toHaveProperty('course_id');expect(fields).not.toHaveProperty('estado');expect(fields).not.toHaveProperty('cedula');
 const code=(email.sendVerificationCodeEmail.mock.calls[0][0] as {code:string}).code;expect(code).toMatch(/^\d{6}$/);
});
it('una cuenta sin solicitud obtiene éxito genérico sin crear nada ni enviar código',async()=>{
 const from=jest.fn().mockReturnValueOnce(createChain({data:null,error:null})).mockReturnValueOnce(createChain({data:{id:'c'},error:null})),rpc=jest.fn().mockResolvedValue({data:true,error:null}),email={sendVerificationCodeEmail:jest.fn()};
 const service=new SolicitudService({from,rpc} as unknown as SupabaseClient<Database>,email as unknown as EmailService,{} as AccountService,{} as CohortAssignmentService);
 await expect(service.verificarCorreo('ana@example.com','c')).resolves.toBeUndefined();expect(from).toHaveBeenCalledTimes(2);expect(email.sendVerificationCodeEmail).not.toHaveBeenCalled();
});
it.each([['pendiente_revision',null,'borrador'],['pendiente_revision','2026-10-01','enviada'],['aprobada','2026-10-01','aprobada'],['rechazada','2026-10-01','rechazada']])('progreso deriva %s/%s como %s',async(estado,enviada_at,expected)=>{
 const from=createSupabaseFromMock([{data:{id:'s',course_id:'c',estado,enviada_at,motivo_rechazo:'Corregir',correo_verificado:true},error:null},{data:null,error:null},{data:[],error:null}]);
 const result=await new SolicitudPrivacyService({from} as unknown as SupabaseClient<Database>).progress('s');expect(result.estado).toBe(expected);expect(result.enviadaAt).toBe(enviada_at);expect('motivoRechazo' in result).toBe(expected==='rechazada');
});
it('confirma el código de una aprobada sin exponer su estado en la confirmación',async()=>{
 const row={id:'s',estado:'aprobada',codigo_verificacion:createHash('sha256').update('012345').digest('hex'),codigo_expira_at:new Date(Date.now()+60000).toISOString(),intentos_codigo:0};const from=createSupabaseFromMock([{data:row,error:null},{data:{id:'s'},error:null}]);
 const service=new SolicitudService({from} as unknown as SupabaseClient<Database>,{} as EmailService,{} as AccountService,{} as CohortAssignmentService);
 const result=await service.confirmarCodigo('ana@example.com','012345');expect(result).toHaveProperty('token');expect(result).not.toHaveProperty('estado');
});
