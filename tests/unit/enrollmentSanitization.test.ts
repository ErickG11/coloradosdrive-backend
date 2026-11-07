import {
  sanitizeEnrollmentText,
  normalizeEnrollmentEmail,
  isDisposableEmailDomain,
  requireKnownFields,
} from '../../src/utils/enrollmentSanitization';
import { normalizeEmail, normalizeName } from '../../src/utils/solicitudFields';

test('NFC, espacios y eliminación de controles, ancho cero y controles bidi', () => {
  expect(sanitizeEnrollmentText('  Jose\u0301\t\n Pe\u200brez\u202e\u2066\u2069\u0000  ')).toBe(
    'José Perez',
  );
  expect(normalizeName(' Ana\u202e María\u200b ')).toBe('Ana María');
});
test.each(['gmail.com', 'googlemail.com'])(
  'compara %s sin puntos/etiqueta pero conserva dirección de entrega',
  (domain) => {
    expect(normalizeEnrollmentEmail(` A.B+Inscripcion@${domain.toUpperCase()} `)).toEqual({
      correo: `a.b+inscripcion@${domain}`,
      correoNormalizado: 'ab@gmail.com',
    });
  },
);
test('otros proveedores conservan puntos y etiquetas; la API anterior usa el mismo normalizador', () => {
  expect(normalizeEnrollmentEmail('A.B+Etiqueta@EXAMPLE.INVALID')).toEqual({
    correo: 'a.b+etiqueta@example.invalid',
    correoNormalizado: 'a.b+etiqueta@example.invalid',
  });
  expect(normalizeEmail(' A.B+Etiqueta@EXAMPLE.INVALID ')).toBe('a.b+etiqueta@example.invalid');
});
test('dominios IDNA se normalizan sin red', () => {
  expect(normalizeEnrollmentEmail('ana@españa.example').correo).toBe('ana@xn--espaa-rta.example');
});
test.each([
  'mailinator.com',
  'guerrillamail.com',
  '10minutemail.com',
  'tempmail.com',
  'temp-mail.org',
  'sub.mailinator.com',
])('rechaza dominio desechable %s', (domain) => {
  expect(isDisposableEmailDomain(domain)).toBe(true);
  expect(() => normalizeEnrollmentEmail(`persona@${domain}`)).toThrow(
    expect.objectContaining({ code: 'CORREO_NO_ADMITIDO' }),
  );
});
test('comparación por dominio no bloquea sufijos parecidos', () => {
  expect(isDisposableEmailDomain('notmailinator.com')).toBe(false);
  expect(isDisposableEmailDomain('mailinator.com.example.invalid')).toBe(false);
});
test.each([
  null,
  {},
  'a@b@c.com',
  'a\r\nBcc: otro@example.invalid',
  '<script>@example.invalid',
  '.a@example.invalid',
  'a..b@example.invalid',
  'a@-example.invalid',
  'a@localhost',
  'a'.repeat(65) + '@example.invalid',
  'a'.repeat(255) + '@example.invalid',
])('rechaza correo inválido sin reflejar entrada (%#)', (value) => {
  expect(() => normalizeEnrollmentEmail(value)).toThrow(
    expect.objectContaining({ code: 'CORREO_INVALIDO', field: 'correo' }),
  );
});
test('CRLF en texto se elimina y el asunto queda en una línea', () => {
  expect(sanitizeEnrollmentText('Título\r\nBcc: intento')).toBe('Título Bcc: intento');
});
test.each([null, [], 4, 'cuerpo', Object.create({ estado: 'aprobada' })])(
  'rechaza cuerpos no planos (%#)',
  (body) => {
    expect(() => {
      requireKnownFields(body, ['correo']);
    }).toThrow(expect.objectContaining({ code: 'CUERPO_INVALIDO' }));
  },
);
test.each(['estado', 'student_id', '__proto__', 'constructor', 'toString'])(
  'anti mass assignment rechaza %s',
  (key) => {
    const body = JSON.parse(`{"correo":"ana@example.invalid","${key}":"valor"}`);
    expect(() => {
      requireKnownFields(body, ['correo']);
    }).toThrow(expect.objectContaining({ code: 'CAMPO_NO_PERMITIDO' }));
  },
);
test('no imprime ni refleja claves desconocidas y admite únicamente las permitidas', () => {
  expect(() => {
    requireKnownFields({ correo: 'ana@example.invalid' }, ['correo']);
  }).not.toThrow();
  expect(() => {
    requireKnownFields({ [Symbol('oculto')]: 'dato' }, ['correo']);
  }).toThrow('campos no permitidos');
});
