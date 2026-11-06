import {
  validateEnrollmentData,
  validateNamePart,
  validateEnrollmentBirthDate,
  validateEducationLevel,
  validateCertificateSubtype,
  validateVerificationCode,
  validateEnrollmentDecision,
  validateAdminVerification,
} from '../../src/utils/enrollmentValidation';
import { MOTIVOS_DEVOLUCION, MOTIVOS_RECHAZO } from '../../src/config/enrollmentCatalog';
const now = new Date('2026-11-03T15:00:00Z');
const valid = {
  nombres: 'Ana María',
  apellidos: 'Pérez O’Neill',
  cedula: '1710034065',
  fechaNacimiento: '1990-05-06',
  nacionalidadTipo: 'ecuatoriana',
  tipoSangre: 'no_sabe',
};
const parse = (input: unknown) => validateEnrollmentData(input, 18, now);

test('datos separados derivan nombre y omiten teléfono vacío', () => {
  expect(parse({ ...valid, nombres: '  Ana\tMari\u0301a ', telefono: '' })).toEqual({
    ...valid,
    nombres: 'Ana María',
    nombreCompleto: 'Ana María Pérez O’Neill',
  });
});
test.each(['Án', 'O’Neill', 'Pérez-López', 'María José'])('nombre válido %s', (name) => {
  expect(validateNamePart(name, 'nombres')).toBe(name);
});
test.each(['A', 'A'.repeat(61), '123', 'Ana <script>', 'Ana_', '--Ana', '\u0301\u0300'])(
  'nombre inválido %s',
  (name) => {
    expect(() => validateNamePart(name, 'nombres')).toThrow();
  },
);
test('límites exactos de nombres 2–60 y sangre/nacionalidad de catálogo', () => {
  expect(validateNamePart('Á'.repeat(60), 'apellidos')).toHaveLength(60);
  expect(
    parse({ ...valid, nacionalidadTipo: 'extranjero_con_cedula', tipoSangre: 'AB-' }),
  ).toMatchObject({ tipoSangre: 'AB-' });
  expect(() => parse({ ...valid, tipoSangre: 'AB positivo' })).toThrow(
    expect.objectContaining({ field: 'tipoSangre' }),
  );
});
test('extranjero sin cédula se deriva antes de pedir cédula', () => {
  expect(() => parse({ nacionalidadTipo: 'extranjero_sin_cedula' })).toThrow(
    expect.objectContaining({ code: 'ATENCION_POR_CONTACTO' }),
  );
});
test.each(['estado', 'nombreCompleto', 'studentId', 'reviewed_by', 'correo'])(
  'datos rechaza asignación de %s',
  (field) => {
    expect(() => parse({ ...valid, [field]: 'alterado' })).toThrow(
      expect.objectContaining({ code: 'CAMPO_NO_PERMITIDO' }),
    );
  },
);
test.each(['0010034065', '2510034065', '1760034065', '1710034064', '171003406', '17100340655'])(
  'usa el único validador de cédula para %s',
  (cedula) => {
    expect(() => parse({ ...valid, cedula })).toThrow(
      expect.objectContaining({ code: 'CEDULA_INVALIDA' }),
    );
  },
);
test.each([
  ['0991234567', '0991234567'],
  ['022345678', '022345678'],
  ['+593991234567', '0991234567'],
  ['+59322345678', '022345678'],
])('normaliza teléfono %s', (telefono, expected) => {
  expect(parse({ ...valid, telefono }).telefono).toBe(expected);
});
test.each(['081234567', '1234567890', '+5930991234567', '09 12345678', null])(
  'teléfono inválido (%#)',
  (telefono) => {
    expect(() => parse({ ...valid, telefono })).toThrow(
      expect.objectContaining({ code: 'TELEFONO_INVALIDO' }),
    );
  },
);
test('edad exacta usa día civil de Guayaquil y mínimo del curso, sin mínimo fijo 15', () => {
  expect(validateEnrollmentBirthDate('2008-11-03', 18, now).edad).toBe(18);
  expect(() => validateEnrollmentBirthDate('2008-11-04', 18, now)).toThrow(
    expect.objectContaining({ code: 'EDAD_MINIMA' }),
  );
  expect(validateEnrollmentBirthDate('2012-11-03', 14, now).edad).toBe(14);
  expect(validateEnrollmentBirthDate('1926-11-03', 18, now).edad).toBe(100);
  expect(() => validateEnrollmentBirthDate('1925-11-03', 18, now)).toThrow(
    expect.objectContaining({ code: 'EDAD_MAXIMA' }),
  );
  expect(validateEnrollmentBirthDate('2008-11-03', 18, new Date('2026-11-04T02:00:00Z')).edad).toBe(
    18,
  );
});
test.each(['2027-01-01', '2026-02-30', '2026-11-04', '2000-13-01', '2000-2-01', 'no es fecha'])(
  'fecha inválida %s',
  (date) => {
    expect(() => validateEnrollmentBirthDate(date, 18, now)).toThrow(
      expect.objectContaining({ code: 'FECHA_INVALIDA' }),
    );
  },
);
test('menor con curso habilitado exige representante distinto y autorizado', () => {
  const menor = { ...valid, fechaNacimiento: '2009-11-03' };
  expect(() => validateEnrollmentData(menor, 17, now)).toThrow(
    expect.objectContaining({ code: 'REPRESENTANTE_REQUERIDO' }),
  );
  const representante = { nombre: 'María Torres', cedula: '0926687856', acepta: true };
  expect(validateEnrollmentData({ ...menor, representante }, 17, now).representante).toEqual(
    representante,
  );
  expect(() =>
    validateEnrollmentData(
      { ...menor, representante: { ...representante, cedula: valid.cedula } },
      17,
      now,
    ),
  ).toThrow(expect.objectContaining({ code: 'REPRESENTANTE_REQUERIDO' }));
  expect(() =>
    validateEnrollmentData(
      { ...menor, representante: { ...representante, acepta: 'true' } },
      17,
      now,
    ),
  ).toThrow(expect.objectContaining({ code: 'REPRESENTANTE_REQUERIDO' }));
  expect(() =>
    validateEnrollmentData(
      { ...menor, representante: { ...representante, estado: 'aprobada' } },
      17,
      now,
    ),
  ).toThrow(expect.objectContaining({ code: 'CAMPO_NO_PERMITIDO' }));
  expect(() => parse({ ...valid, representante })).toThrow(
    expect.objectContaining({ code: 'REPRESENTANTE_NO_APLICA' }),
  );
});
test.each([
  'bachiller',
  'bachiller_reciente',
  'bachiller_exterior',
  'decimo_aprobado',
  'cursando_bachillerato',
])('nivel admitido %s', (nivel) => {
  expect(validateEducationLevel(nivel)).toBe(nivel);
});
test('menos de décimo nunca pasa a persistencia y no acepta subtipos ajenos', () => {
  expect(() => parse({ ...valid, nivelEstudios: 'menos_de_decimo' })).toThrow(
    expect.objectContaining({ code: 'NIVEL_ESTUDIOS_NO_ADMITIDO' }),
  );
  expect(validateCertificateSubtype('bachiller_exterior', 'resolucion_homologacion')).toBe(
    'resolucion_homologacion',
  );
  expect(() => validateCertificateSubtype('bachiller_exterior', 'acta_grado')).toThrow(
    expect.objectContaining({ code: 'SUBTIPO_CERTIFICADO_INVALIDO' }),
  );
  expect(() => validateCertificateSubtype('bachiller', 'acta_grado')).toThrow();
});
test('código conserva ceros y exige string de seis dígitos sin espacios', () => {
  expect(validateVerificationCode('001234')).toBe('001234');
  for (const value of [123456, '12345', '1234567', '123 45', ' 123456', '１２３４５６'])
    expect(() => validateVerificationCode(value)).toThrow(
      expect.objectContaining({ code: 'CODIGO_INVALIDO_O_VENCIDO' }),
    );
});
test.each(Object.keys(MOTIVOS_DEVOLUCION).filter((c) => c !== 'OTRO'))(
  'devolver %s usa mensaje predefinido',
  (motivoCodigo) => {
    expect(validateEnrollmentDecision({ accion: 'devolver', motivoCodigo }).mensaje).toBe(
      MOTIVOS_DEVOLUCION[motivoCodigo as keyof typeof MOTIVOS_DEVOLUCION],
    );
  },
);
test.each(['devolver', 'rechazar'])('OTRO en %s exige texto plano 10–300', (accion) => {
  expect(
    validateEnrollmentDecision({ accion, motivoCodigo: 'OTRO', mensaje: 'Revisar el original.' })
      .mensaje,
  ).toBe('Revisar el original.');
  for (const mensaje of [undefined, 'corto', 'x'.repeat(301), '<img src=x onerror=alert(1)>'])
    expect(() => validateEnrollmentDecision({ accion, motivoCodigo: 'OTRO', mensaje })).toThrow();
});
test('decisiones rechazan campos ajenos, motivo del otro catálogo, vencimiento manual y mensaje sobreescrito', () => {
  for (const body of [
    { accion: 'aprobar', studentId: 'otro' },
    { accion: 'aprobar', motivoCodigo: 'OTRO' },
    { accion: 'devolver', motivoCodigo: 'SPAM' },
    { accion: 'rechazar', motivoCodigo: 'VENCIDA' },
    { accion: 'devolver', motivoCodigo: 'CEDULA_MAL_ESCRITA', mensaje: 'Sobreescribir texto' },
  ])
    expect(() => validateEnrollmentDecision(body)).toThrow();
  expect(
    validateEnrollmentDecision({ accion: 'aprobar', notaInterna: 'Revisión técnica.' }),
  ).toEqual({
    accion: 'aprobar',
    motivoCodigo: null,
    mensaje: null,
    notaInterna: 'Revisión técnica.',
  });
});
test.each(Object.keys(MOTIVOS_RECHAZO).filter((c) => !['OTRO', 'VENCIDA'].includes(c)))(
  'rechazo %s no expone nota interna en mensaje',
  (motivoCodigo) => {
    const value = validateEnrollmentDecision({
      accion: 'rechazar',
      motivoCodigo,
      notaInterna: 'Nota técnica privada.',
    });
    expect(value.mensaje).not.toContain('Nota técnica privada');
  },
);
test('verificación permite revisión visual registrada pero no web service manual ni campos falsificados', () => {
  expect(
    validateAdminVerification({
      tipo: 'identidad',
      metodo: 'revision_visual',
      resultado: 'no_coincide',
      nota: 'Pendiente de fuente.',
    }),
  ).toMatchObject({ metodo: 'revision_visual' });
  expect(() =>
    validateAdminVerification({
      tipo: 'identidad',
      metodo: 'registro_civil_web_service',
      resultado: 'verificado',
    }),
  ).toThrow(expect.objectContaining({ code: 'METODO_INVALIDO' }));
  expect(() =>
    validateAdminVerification({
      tipo: 'identidad',
      metodo: 'registro_civil_portal',
      resultado: 'verificado',
      actorId: 'falso',
    }),
  ).toThrow(expect.objectContaining({ code: 'CAMPO_NO_PERMITIDO' }));
});
