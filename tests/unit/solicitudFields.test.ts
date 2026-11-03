import { normalizeName, normalizePhone, normalizeEmail, validateCedula } from '../../src/utils/solicitudFields';
import { validateApplicant } from '../../src/utils/solicitudAge';
it.each(['Ana María','José O’Neill','María Pérez-López'])('acepta nombre %s', value => expect(normalizeName(value)).toBe(value));
it.each(['Ana','12345 Perez','Ana <script>','A '.repeat(101)])('rechaza nombre inválido %s', value => expect(()=>normalizeName(value)).toThrow());
it('normaliza espacios',()=>expect(normalizeName('  Ana   Torres ')).toBe('Ana Torres'));
it.each([['0991234567','0991234567'],['022345678','022345678'],['+593991234567','0991234567'],['+59322345678','022345678']])('normaliza teléfono %s', (input,expected)=>expect(normalizePhone(input)).toBe(expected));
it.each(['123','081234567','09912345678','+5930912345678'])('rechaza teléfono %s',value=>expect(()=>normalizePhone(value)).toThrow());
it('normaliza correo y limita longitud',()=>{expect(normalizeEmail(' ANA@EXAMPLE.COM ')).toBe('ana@example.com');expect(()=>normalizeEmail('a'.repeat(250)+'@a.com')).toThrow();});
it('cédula valida provincia, tercer dígito y verificador',()=>{expect(()=>validateCedula('1710034065')).not.toThrow();for(const value of ['0010034065','2510034065','1760034065','1710034064'])expect(()=>validateCedula(value)).toThrow();});
it('acepta exactamente 15 y 100 años y rechaza los extremos',()=>{
 const now=new Date('2026-11-03T15:00:00Z');expect(()=>validateApplicant('1926-11-03',undefined,now)).not.toThrow();expect(()=>validateApplicant('1925-11-03',undefined,now)).toThrow();
 expect(()=>validateApplicant('2011-11-03',{nombre:'María Torres',cedula:'1710034065',acepta:true},now,'0926687856')).not.toThrow();
 expect(()=>validateApplicant('2011-11-04',undefined,now)).toThrow();expect(()=>validateApplicant('2026-02-30',undefined,now)).toThrow();
 expect(()=>validateApplicant('2011-11-03',{nombre:'María Torres',cedula:'1710034065',acepta:true},now,'1710034065')).toThrow();
});
