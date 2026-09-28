import { Router } from 'express';
import { body, param, query } from 'express-validator';

import {
  completarDatos,
  confirmarCodigo,
  decidirSolicitud,
  listarSolicitudes,
  revisarDocumento,
  subirDocumento,
  verificarCorreo,
} from '../controllers/solicitud.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { applicationRateLimiter, verificationRateLimiter } from '../middlewares/rateLimit';
import { requireRole } from '../middlewares/rbac.middleware';
import { authenticateSolicitud } from '../middlewares/solicitudAuth.middleware';
import { uploadDocumento } from '../middlewares/upload';
import { validate } from '../middlewares/validate';
import {
  DOCUMENTO_ESTADOS_REVISION,
  SOLICITUD_ESTADOS,
  TIPOS_DOCUMENTO,
} from '../models/solicitud.model';
import { asyncHandler } from '../utils/asyncHandler';
import { isValidCedulaEcuatoriana } from '../utils/cedula';

// ---------------------------------------------------------------------------
// Público (postulante): solicitudes de inscripción online. Sin cuenta de
// Supabase Auth todavía; después de verificar el correo se usa el token
// temporal de solicitudAuth.middleware.ts.
// ---------------------------------------------------------------------------
export const solicitudRouter = Router();

const correoValidator = body('correo')
  .trim()
  .isEmail()
  .withMessage('correo debe ser un correo electrónico válido');
const idParamValidator = param('id').isUUID().withMessage('id debe ser un UUID válido');

solicitudRouter.post(
  '/verificar-correo',
  verificationRateLimiter,
  [
    correoValidator,
    body('courseId').isUUID().withMessage('courseId debe ser un UUID válido'),
  ],
  validate,
  asyncHandler(verificarCorreo),
);

solicitudRouter.post(
  '/confirmar-codigo',
  verificationRateLimiter,
  [
    correoValidator,
    body('codigo')
      .matches(/^[0-9]{6}$/)
      .withMessage('codigo debe tener 6 dígitos'),
  ],
  validate,
  asyncHandler(confirmarCodigo),
);

function validateFechaNacimiento(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('fechaNacimiento debe tener el formato YYYY-MM-DD');
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error('fechaNacimiento no es una fecha válida');
  }
  if (date.getTime() > Date.now() || date.getUTCFullYear() < 1900) {
    throw new Error('fechaNacimiento fuera de rango');
  }
  return true;
}

solicitudRouter.put(
  '/:id/datos',
  applicationRateLimiter,
  authenticateSolicitud,
  [
    idParamValidator,
    body('cedula')
      .custom((value: unknown) => typeof value === 'string' && isValidCedulaEcuatoriana(value))
      .withMessage('cedula no es una cédula ecuatoriana válida'),
    body('nombreCompleto')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('nombreCompleto es obligatorio'),
    body('telefono')
      .optional()
      .isString()
      .trim()
      .notEmpty()
      .isLength({ max: 20 })
      .withMessage('telefono no puede estar vacío ni superar 20 caracteres si se envía'),
    body('fechaNacimiento').custom(validateFechaNacimiento),
  ],
  validate,
  asyncHandler(completarDatos),
);

// El archivo se recibe DESPUÉS de autenticar y limitar (no se bufferiza
// nada de quien no tiene token válido) y los campos de texto del multipart
// solo existen en req.body después de que Multer los procesa.
solicitudRouter.post(
  '/:id/documentos',
  applicationRateLimiter,
  authenticateSolicitud,
  uploadDocumento,
  [
    idParamValidator,
    body('tipo_documento')
      .isIn(TIPOS_DOCUMENTO)
      .withMessage('tipo_documento debe ser uno de: ' + TIPOS_DOCUMENTO.join(', ')),
  ],
  validate,
  asyncHandler(subirDocumento),
);

// ---------------------------------------------------------------------------
// Admin: checklist y decisión sobre las solicitudes
// ---------------------------------------------------------------------------
export const solicitudAdminRouter = Router();

solicitudAdminRouter.use(asyncHandler(authenticate), requireRole('admin'));

const motivoValidator = body('motivoRechazo')
  .optional()
  .isString()
  .trim()
  .notEmpty()
  .withMessage('motivoRechazo no puede estar vacío si se envía');

solicitudAdminRouter.get(
  '/',
  [
    query('estado')
      .optional()
      .isIn(SOLICITUD_ESTADOS)
      .withMessage('estado debe ser uno de: ' + SOLICITUD_ESTADOS.join(', ')),
  ],
  validate,
  asyncHandler(listarSolicitudes),
);

solicitudAdminRouter.patch(
  '/:id/documentos/:docId',
  [
    idParamValidator,
    param('docId').isUUID().withMessage('docId debe ser un UUID válido'),
    body('estado')
      .isIn(DOCUMENTO_ESTADOS_REVISION)
      .withMessage('estado debe ser uno de: ' + DOCUMENTO_ESTADOS_REVISION.join(', ')),
    motivoValidator,
  ],
  validate,
  asyncHandler(revisarDocumento),
);

solicitudAdminRouter.patch(
  '/:id',
  [
    idParamValidator,
    body('estado')
      .isIn(['aprobada', 'rechazada'])
      .withMessage('estado debe ser aprobada o rechazada'),
    motivoValidator,
  ],
  validate,
  asyncHandler(decidirSolicitud),
);
