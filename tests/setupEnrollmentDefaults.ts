// Las pruebas con mocks de Supabase se escribieron para el comportamiento anterior a las
// reglas nuevas de inscripción (indicadores apagados). Sin este valor por defecto, cada
// consulta a enrollment_rule_flags consumiría una respuesta de los mocks de `from` y
// desordenaría las pruebas. Una prueba que necesite un indicador encendido lo declara:
//   (enrollmentRuleEnabled as jest.Mock).mockResolvedValue(true)
// Las reglas nuevas se verifican contra PostgreSQL aislado (tests/unit/*Sql.test.ts).
jest.mock('../src/services/enrollmentRuleFlags.service', () => ({
  enrollmentRuleEnabled: jest.fn().mockResolvedValue(false),
}));

// El permiso por operación lo decide la función SQL assert_enrollment_permission_v2 (verificada
// contra PostgreSQL aislado). Las pruebas de rutas con mocks no simulan esa llamada, así que aquí
// el middleware deja pasar; su comportamiento propio se prueba en
// tests/unit/enrollmentPermission.middleware.test.ts con jest.requireActual.
jest.mock('../src/middlewares/enrollmentPermission.middleware', () => ({
  requireEnrollmentPermission: () => (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
}));

// inscripcionIncompleta consulta primero el acceso individual por matrícula (indicador
// enrollment_access). Con el indicador apagado el servicio responde "inactivo" y se conserva la
// consulta anterior de matrículas; así las pruebas de rutas no necesitan una lectura adicional.
// El servicio se prueba por separado en tests/unit/individualEnrollmentAccess.service.test.ts.
jest.mock('../src/services/individualEnrollmentAccess.service', () => ({
  individualEnrollmentAccess: jest
    .fn()
    .mockResolvedValue({ active: false, serverNow: '2026-01-01T00:00:00.000Z', enrollments: [] }),
}));
