import request from 'supertest';
jest.mock('../../src/config/supabase',()=>({supabaseAdmin:{from:jest.fn(),storage:{from:jest.fn()}},supabaseAnon:{}}));
jest.mock('../../src/config/mailer',()=>({mailer:{sendMail:jest.fn()}}));
jest.mock('../../src/config/jwks',()=>({verifySupabaseJwt:jest.fn()}));
import {createApp} from '../../src/app';
import {supabaseAdmin} from '../../src/config/supabase';
import {verifySupabaseJwt} from '../../src/config/jwks';
import {createChain} from '../helpers/supabaseMock';
import {mockAuthToken} from '../helpers/tokens';
const app=createApp(),from=supabaseAdmin.from as jest.Mock,storage=supabaseAdmin.storage.from as jest.Mock;
function auth(){return `Bearer ${mockAuthToken(verifySupabaseJwt as unknown as jest.Mock,'estudiante')}`;}
const user={activo:true,debe_cambiar_password:false,fecha_nacimiento:'1950-01-01'};
beforeEach(()=>{from.mockReset();storage.mockReset();});
it('GET usa sesión del alumno y devuelve solo su expediente',async()=>{
 from.mockReturnValueOnce(createChain({data:user,error:null})).mockReturnValueOnce(createChain({data:user,error:null})).mockReturnValueOnce(createChain({data:{id:'own',estado:'aprobada'},error:null})).mockReturnValueOnce(createChain({data:[],error:null})).mockReturnValueOnce(createChain({data:[],error:null}));
 const res=await request(app).get('/estudiantes/documentos').set('Authorization',auth());expect(res.status).toBe(200);expect(res.body.documentos).toHaveLength(4);expect(res.body.documentos[1].exento).toBe(true);expect(from.mock.results[2].value.eq).toHaveBeenCalledWith('student_id','test-user-id');
});
it.each([{activo:false,debe_cambiar_password:false},{activo:true,debe_cambiar_password:true}])('rechaza acceso no habilitado %j',async value=>{from.mockReturnValue(createChain({data:value,error:null}));const res=await request(app).get('/estudiantes/documentos').set('Authorization',auth());expect(res.status).toBe(403);expect(from).toHaveBeenCalledTimes(1);});
it('POST reemplaza un rechazado propio y lo devuelve a recibido',async()=>{
 const upload=jest.fn().mockResolvedValue({error:null}),remove=jest.fn().mockResolvedValue({error:null});storage.mockReturnValue({upload,remove});
 from.mockReturnValueOnce(createChain({data:user,error:null})).mockReturnValueOnce(createChain({data:user,error:null})).mockReturnValueOnce(createChain({data:{id:'own',estado:'aprobada'},error:null})).mockReturnValueOnce(createChain({data:{id:'d',estado:'rechazado',storage_path:'old'},error:null})).mockReturnValueOnce(createChain({data:{id:'d',tipo_documento:'cedula',estado:'recibido',uploaded_at:'2026-11-03'},error:null}));
 const res=await request(app).post('/estudiantes/documentos').set('Authorization',auth()).field('tipo_documento','cedula').attach('archivo',Buffer.from('%PDF-1.4 ficticio'),{filename:'../../privado.pdf',contentType:'application/pdf'});
 expect(res.status).toBe(201);expect(res.body.estado).toBe('recibido');expect(upload.mock.calls[0][0]).toMatch(/^own\/cedula-[a-f0-9-]+\.pdf$/);expect(remove).toHaveBeenCalledWith(['old']);
});
