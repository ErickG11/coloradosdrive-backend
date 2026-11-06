import type { NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { LIMITES_CERTIFICADO } from '../config/enrollmentCatalog';
import { AppError } from '../utils/AppError';
import { solicitudError } from '../utils/solicitudError';

// Margen para los encabezados multipart (límites y campos de texto) sobre el archivo.
const MULTIPART_OVERHEAD = 16 * 1024;
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'application/pdf'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: LIMITES_CERTIFICADO.bytes,
    files: 1,
    fields: 2,
    fieldSize: 256,
    parts: 3,
    headerPairs: 20,
  },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname !== 'archivo' || !ALLOWED_MIMES.includes(file.mimetype)) {
      cb(
        solicitudError(
          'Solo se admiten archivos JPG, PNG o PDF.',
          400,
          'ARCHIVO_TIPO_NO_PERMITIDO',
        ),
      );
      return;
    }
    cb(null, true);
  },
});
const singleFile = upload.single('archivo');

const tooLarge = (): AppError =>
  solicitudError('El archivo supera los 2 MiB permitidos.', 413, 'ARCHIVO_DEMASIADO_GRANDE');

export const uploadCertificado: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  // Se rechaza antes de leer el cuerpo cuando el tamaño declarado ya excede el tope.
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > LIMITES_CERTIFICADO.bytes + MULTIPART_OVERHEAD) {
    // El servidor corta la conexión: no se lee ni se acumula el resto del cuerpo.
    res.set('Connection', 'close');
    next(tooLarge());
    return;
  }
  singleFile(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError)
      next(
        err.code === 'LIMIT_FILE_SIZE'
          ? tooLarge()
          : solicitudError('El archivo o el formulario no son válidos.', 400, 'ARCHIVO_INVALIDO'),
      );
    else if (err instanceof AppError) next(err);
    else if (err) next(solicitudError('No se pudo leer el archivo.', 400, 'ARCHIVO_INVALIDO'));
    else next();
  });
};
