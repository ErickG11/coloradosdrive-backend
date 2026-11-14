// Las pruebas con mocks de Supabase se escribieron para el comportamiento anterior a las reglas
// nuevas de inscripción (indicadores apagados). Sin estos valores por defecto, cada consulta a
// enrollment_rule_flags, app_settings o al acceso individual consumiría una respuesta de los
// mocks de `from` y desordenaría las pruebas. Las reglas nuevas se verifican contra PostgreSQL
// aislado (tests/unit/*Sql.test.ts y tests/concurrency).
//
// Son funciones simples (no jest.fn) para que `mockReset`/`resetAllMocks` de cada archivo no las
// borre. Una prueba que necesite otro valor declara su propio jest.mock del módulo.

// Indicadores de reglas nuevas apagados.
jest.mock('../src/services/enrollmentRuleFlags.service', () => ({
  enrollmentRuleEnabled: (): Promise<boolean> => Promise.resolve(false),
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
// enrollment_access). Con el indicador apagado responde "inactivo" y se conserva la consulta
// anterior de matrículas. Su servicio se prueba en
// tests/unit/individualEnrollmentAccess.service.test.ts.
jest.mock('../src/services/individualEnrollmentAccess.service', () => ({
  individualEnrollmentAccess: (): Promise<unknown> =>
    Promise.resolve({ active: false, serverNow: '2026-01-01T00:00:00.000Z', enrollments: [] }),
}));

// planEndHour lee la hora de cierre de las prácticas desde app_settings. Las pruebas con mocks
// parten del horario histórico (22:00) para no gastar una respuesta de `from` en esa lectura.
jest.mock('../src/services/planEndHour.service', () => ({
  planEndHour: (): Promise<number> => Promise.resolve(22),
}));
