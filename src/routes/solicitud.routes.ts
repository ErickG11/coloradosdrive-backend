import { Router } from 'express';
import type { RequestHandler } from 'express';
import { body, param, query } from 'express-validator';

import {
  resumenSolicitudes,
  enviarSolicitud,
  aceptarConsentimiento,
  avisoPrivacidad,
  progresoSolicitud,
  completarDatos,
  confirmarCodigo,
  decidirSolicitud,
  documentoUrl,
  eliminarSolicitud,
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
import { validateFields as validate } from '../middlewares/validate';
import {
  DOCUMENTO_ESTADOS_REVISION,
  SOLICITUD_ESTADOS,
  TIPOS_DOCUMENTO,
} from '../models/solicitud.model';
import { asyncHandler } from '../utils/asyncHandler';
import { requireKnownFields } from '../utils/enrollmentSanitization';
import { verifyEnrollmentCaptcha } from '../middlewares/captcha.middleware';
import {
  reserveEnrollmentCodeIp,
  reserveEnrollmentCode,
} from '../middlewares/enrollmentLimits.middleware';

// ---------------------------------------------------------------------------
// Público (postulante): solicitudes de inscripción online. Sin cuenta de
// Supabase Auth todavía; después de verificar el correo se usa el token
// temporal de solicitudAuth.middleware.ts.
// ---------------------------------------------------------------------------
export const solicitudRouter = Router();

const correoValidator = body('correo')
  .trim()
  .toLowerCase()
  .isLength({ max: 254 })
  .isEmail()
  .withMessage('correo debe ser un correo electrónico válido');
const idParamValidator = param('id').isUUID().withMessage('id debe ser un UUID válido');
function knownFields(allowed: readonly string[]): RequestHandler {
  return (req, _res, next) => {
    requireKnownFields(req.body, allowed);
    next();
  };
}

solicitudRouter.post(
  '/verificar-correo',
  reserveEnrollmentCodeIp,
  verifyEnrollmentCaptcha,
  knownFields(['correo', 'courseId', 'captchaToken']),
  [correoValidator, body('courseId').isUUID().withMessage('courseId debe ser un UUID válido')],
  validate,
  reserveEnrollmentCode,
  asyncHandler(verificarCorreo),
);

solicitudRouter.post(
  '/confirmar-codigo',
  verificationRateLimiter,
  knownFields(['correo', 'codigo']),
  [
    correoValidator,
    body('codigo')
      .matches(/^[0-9]{6}$/)
      .withMessage('codigo debe tener 6 dígitos'),
  ],
  validate,
  asyncHandler(confirmarCodigo),
);

solicitudRouter.put(
  '/:id/datos',
  applicationRateLimiter,
  authenticateSolicitud,
  idParamValidator,
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
    query('page').optional().isInt({ min: 1, max: 1000000 }),
    query('pageSize').optional().isInt({ min: 1, max: 100 }),
    query('q').optional().isString().trim().isLength({ max: 100 }),
    query('estado')
      .optional()
      .isIn([...SOLICITUD_ESTADOS, 'con_documentos_por_revisar'])
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

export const privacyRouter = Router();
privacyRouter.get('/aviso-privacidad', avisoPrivacidad);
solicitudRouter.get(
  '/:id/progreso',
  applicationRateLimiter,
  authenticateSolicitud,
  idParamValidator,
  validate,
  asyncHandler(progresoSolicitud),
);

solicitudRouter.put(
  '/:id/consentimiento',
  applicationRateLimiter,
  authenticateSolicitud,
  [idParamValidator, body('versionAviso').isString()],
  validate,
  asyncHandler(aceptarConsentimiento),
);

solicitudAdminRouter.get(
  '/:id/documentos/:docId/url',
  [idParamValidator, param('docId').isUUID()],
  validate,
  asyncHandler(documentoUrl),
);

solicitudAdminRouter.delete('/:id', idParamValidator, validate, asyncHandler(eliminarSolicitud));

solicitudRouter.post(
  '/:id/enviar',
  applicationRateLimiter,
  authenticateSolicitud,
  idParamValidator,
  validate,
  asyncHandler(enviarSolicitud),
);

solicitudAdminRouter.get('/resumen', asyncHandler(resumenSolicitudes));
