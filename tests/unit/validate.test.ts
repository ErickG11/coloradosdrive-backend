import type { NextFunction, Request, Response } from 'express';
import { body } from 'express-validator';

import { validate, validateFields, validateStudentProfile } from '../../src/middlewares/validate';
import { AppError } from '../../src/utils/AppError';

async function runWith(
  middleware: (req: Request, res: Response, next: NextFunction) => void,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const req = { body: payload } as Request;
  await body('precio').isInt().withMessage('El precio es obligatorio.').run(req);
  const next = jest.fn();
  middleware(req, {} as Response, next);
  return next.mock.calls[0][0];
}

describe('validate / validateFields', () => {
  it('validate mantiene su contrato: solo el mensaje, sin code ni field', async () => {
    const error = (await runWith(validate, { precio: 'x' })) as AppError;

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 400, message: 'El precio es obligatorio.' });
    expect(error.code).toBeUndefined();
    expect(error.field).toBeUndefined();
  });

  it('validateFields conserva el campo que falló y el código INVALID_FIELD', async () => {
    const error = (await runWith(validateFields, { precio: 'x' })) as AppError;

    expect(error).toMatchObject({
      statusCode: 400,
      message: 'El precio es obligatorio.',
      code: 'INVALID_FIELD',
      field: 'precio',
    });
  });

  it('sin errores llama a next() sin argumentos', async () => {
    expect(await runWith(validateFields, { precio: 3 })).toBeUndefined();
  });

  it('validateStudentProfile es el mismo middleware (las rutas de alumnos no cambian)', () => {
    expect(validateStudentProfile).toBe(validateFields);
  });
});
