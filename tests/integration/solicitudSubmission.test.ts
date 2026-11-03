import request from 'supertest';
jest.mock('../../src/config/supabase',()=>({supabaseAdmin:{from:jest.fn(),rpc:jest.fn(),storage:{from:jest.fn()}},supabaseAnon:{}}));
jest.mock('../../src/config/mailer',()=>({mailer:{sendMail:jest.fn().mockResolvedValue({})}}));
jest.mock('../../src/config/jwks',()=>({verifySupabaseJwt:jest.fn()}));
import {createApp} from '../../src/app';
import {supabaseAdmin} from '../../src/config/supabase';
import {signSolicitudToken} from '../../src/utils/solicitudToken';
import {createChain} from '../helpers/supabaseMock';
const id='11111111-1111-4111-8111-111111111111',from=supabaseAdmin.from as jest.Mock,rpc=supabaseAdmin.rpc as jest.Mock;
const row={id,course_id:'55555555-5555-4555-8555-555555555555',estado:'pendiente_revision',correo_verificado:true,cedula:'1710034065',nombre_completo:'Ana Torres',fecha_nacimiento:'1990-01-01',solicitada_at:'2026-10-01',enviada_at:null};
const app=createApp(),token=`Bearer ${signSolicitudToken(id)}`;
beforeEach(()=>{from.mockReset();rpc.mockReset().mockResolvedValue({data:{id,estado:'enviada',enviadaAt:'2026-11-03T12:00:00Z'},error:null});});
it.each([['cedula'],['titulo_bachiller'],['cedula','titulo_bachiller']])('POST enviar devuelve faltantes %j',async(...faltantes)=>{
 from.mockReturnValueOnce(createChain({data:row,error:null})).mockReturnValueOnce(createChain({data:{acepto_tratamiento:true,declara_veracidad:true},error:null})).mockReturnValueOnce(createChain({data:['cedula','titulo_bachiller'].filter(tipo=>!faltantes.includes(tipo)).map(tipo_documento=>({tipo_documento})),error:null}));
 const res=await request(app).post(`/solicitudes/${id}/enviar`).set('Authorization',token).send({});expect(res.status).toBe(400);expect(res.body.code).toBe('SOLICITUD_INCOMPLETA');expect(res.body.faltantes).toEqual(faltantes);expect(rpc).not.toHaveBeenCalled();
});
it('rechaza escritura de datos y consentimiento de una enviada',async()=>{
 from.mockImplementation(()=>createChain({data:{...row,enviada_at:'2026-11-03'},error:null}));
 const data=await request(app).put(`/solicitudes/${id}/datos`).set('Authorization',token).send({cedula:row.cedula,nombreCompleto:row.nombre_completo,fechaNacimiento:row.fecha_nacimiento});expect(data.status).toBe(409);expect(data.body.code).toBe('SOLICITUD_ENVIADA');
 const consent=await request(app).put(`/solicitudes/${id}/consentimiento`).set('Authorization',token).send({versionAviso:'2026-10-v1',aceptoTratamiento:true,declaraVeracidad:true});expect(consent.status).toBe(409);expect(consent.body.code).toBe('SOLICITUD_ENVIADA');
});
it('enviar es idempotente por HTTP y mantiene la fecha original',async()=>{
 from.mockReturnValue(createChain({data:{...row,enviada_at:'2026-11-01T12:00:00Z'},error:null}));for(let i=0;i<2;i++){const res=await request(app).post(`/solicitudes/${id}/enviar`).set('Authorization',token);expect(res.status).toBe(200);expect(res.body.enviadaAt).toBe('2026-11-01T12:00:00Z');}expect(rpc).not.toHaveBeenCalled();
});
it('cédula que pertenece a un usuario devuelve conflicto sin identificarlo',async()=>{
 from.mockReturnValueOnce(createChain({data:row,error:null})).mockReturnValueOnce(createChain({data:{id:'consent',acepto_tratamiento:true,declara_veracidad:true},error:null})).mockReturnValueOnce(createChain({data:[],error:null})).mockReturnValueOnce(createChain({data:{id:'private-user'},error:null}));
 const res=await request(app).put(`/solicitudes/${id}/datos`).set('Authorization',token).send({cedula:row.cedula,nombreCompleto:row.nombre_completo,fechaNacimiento:row.fecha_nacimiento});expect(res.status).toBe(409);expect(res.body.code).toBe('CEDULA_YA_REGISTRADA');expect(JSON.stringify(res.body)).not.toContain('private-user');
});
