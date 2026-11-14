import { translateCohortSqlError } from '../../src/config/cohortErrors';
test('la cancelación bloqueada conserva el código y publica el conteo seguro', () => {
  expect(
    translateCohortSqlError({
      code: 'P7000',
      message: 'COHORTE_CANCELACION_BLOQUEADA',
      details: '{"cantidad":4}',
    }),
  ).toMatchObject({
    statusCode: 409,
    code: 'COHORTE_CANCELACION_BLOQUEADA',
    detalles: { cantidad: 4 },
    message:
      'No puedes cancelar: 4 alumnos tienen matrículas activas o reservas vigentes en esta cohorte.',
  });
});
test('no devuelve un detalle SQL arbitrario o un conteo inválido', () => {
  expect(
    translateCohortSqlError({
      code: 'P7000',
      message: 'COHORTE_CANCELACION_BLOQUEADA',
      details: '{"cantidad":"dato privado"}',
    }),
  ).toMatchObject({
    code: 'COHORTE_CANCELACION_BLOQUEADA',
    message: 'Hay matrículas que deben resolverse antes de cancelar.',
  });
});
