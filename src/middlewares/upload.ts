import type { NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';

import { ALLOWED_MIMETYPES } from '../services/solicitud.service';
import { AppError } from '../utils/AppError';

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

// En memoria (no en disco): el archivo se reenvía directo a Supabase
// Storage y nunca toca el sistema de archivos del servidor.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIMETYPES.includes(file.mimetype)) {
      cb(new AppError('Tipo de archivo no permitido (solo JPG, PNG o PDF)', 400));
      return;
    }
    cb(null, true);
  },
});

const singleFile = upload.single('archivo');

// Traduce los errores de Multer a errores HTTP controlados (400/413) en
// vez de dejarlos caer como 500 en el manejador central.
export const uploadDocumento: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  singleFile(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      const tooLarge = err.code === 'LIMIT_FILE_SIZE';
      next(
        new AppError(
          tooLarge ? 'El archivo supera el tamaño máximo de 5 MB' : 'Archivo inválido',
          tooLarge ? 413 : 400,
        ),
      );
      return;
    }
    next(err);
  });
};
