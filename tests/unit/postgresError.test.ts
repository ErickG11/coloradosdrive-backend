import { AppError } from '../../src/utils/AppError';
import { mapPostgresError, postgresConstraintName } from '../../src/utils/postgresError';

describe('postgresConstraintName', () => {
  it('extrae el nombre de la restricción del mensaje de PostgREST', () => {
    expect(
      postgresConstraintName({
        code: '23514',
        message: 'new row for relation "cohorts" violates check constraint "cohorts_precio_maximo"',
      }),
    ).toBe('cohorts_precio_maximo');
  });

  it.each([null, undefined, {}, { message: 42 }, { message: 'sin restricción' }])(
    'devuelve undefined si no hay nombre (%p)',
    (error) => {
      expect(postgresConstraintName(error)).toBeUndefined();
    },
  );
});

describe('mapPostgresError', () => {
  it.each<[string, number, string, string]>([
    ['22003', 400, 'VALUE_OUT_OF_RANGE', 'Un valor numérico está fuera del rango permitido.'],
    ['23505', 409, 'DUPLICATE', 'Ya existe un registro con esos datos.'],
    ['23514', 400, 'CHECK_VIOLATION', 'Los datos no cumplen las reglas de validación.'],
    [
      '23503',
      409,
      'FOREIGN_KEY_VIOLATION',
      'El registro está relacionado con otros datos y no se puede completar la operación.',
    ],
  ])('traduce %s a %i con mensaje genérico en español', (code, status, appCode, message) => {
    const mapped = mapPostgresError({ code, message: 'detalle técnico' });

    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped).toMatchObject({ statusCode: status, code: appCode, message });
    expect(mapped?.field).toBeUndefined();
  });

  it('usa el mensaje y campo propios de la restricción si se indican', () => {
    const mapped = mapPostgresError(
      { code: '23505', message: 'violates unique constraint "x_unique"' },
      { x_unique: { status: 409, message: 'Repetido.', code: 'X_DUP', field: 'nombre' } },
    );

    expect(mapped).toMatchObject({
      statusCode: 409,
      message: 'Repetido.',
      code: 'X_DUP',
      field: 'nombre',
    });
  });

  it('cae al genérico si la restricción no está en el mapa', () => {
    const mapped = mapPostgresError(
      { code: '23514', message: 'violates check constraint "otra"' },
      { x_unique: { status: 409, message: 'Repetido.', code: 'X_DUP' } },
    );

    expect(mapped?.code).toBe('CHECK_VIOLATION');
  });

  it('no confunde propiedades heredadas con restricciones', () => {
    const mapped = mapPostgresError({ code: '23514', message: 'constraint "toString"' });

    expect(mapped?.code).toBe('CHECK_VIOLATION');
  });

  it('deja pasar un AppError sin tocarlo', () => {
    const original = new AppError('Ya existe', 409);

    expect(mapPostgresError(original)).toBe(original);
  });

  it.each([null, undefined, new Error('x'), { code: '08006' }, { code: 'toString' }, { code: 1 }])(
    'devuelve null para errores desconocidos (%p), que siguen siendo 500',
    (error) => {
      expect(mapPostgresError(error)).toBeNull();
    },
  );
});
