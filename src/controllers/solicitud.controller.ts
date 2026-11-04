import type { Request, Response } from 'express';

import { mailer } from '../config/mailer';
import { supabaseAdmin } from '../config/supabase';
import type {
  CompletarDatosResult,
  ConfirmarCodigoResult,
  SolicitudDocumentoResult,
  VerificarCorreoInput,
} from '../models/solicitud.model';
import { AccountService } from '../services/account.service';
import { CohortAssignmentService } from '../services/cohortAssignment.service';
import { EmailService } from '../services/email.service';
import { SolicitudService } from '../services/solicitud.service';
import { SolicitudAdminService, type AdminEstadoLista } from '../services/solicitudAdmin.service';
import { SolicitudDecisionService } from '../services/solicitudDecision.service';
import { SolicitudPrivacyService, privacyNotice } from '../services/solicitudPrivacy.service';
import { SolicitudDocumentAccessService } from '../services/solicitudAudit.service';
import { SolicitudDeletionService } from '../services/solicitudDeletion.service';
import { AppError } from '../utils/AppError';
import { uniformVerification } from '../utils/uniformVerification';
import { MENSAJE_VERIFICACION_CORREO } from '../config/enrollmentCatalog';

const solicitudService = new SolicitudService(
  supabaseAdmin,
  new EmailService(mailer),
  new AccountService(supabaseAdmin),
  new CohortAssignmentService(supabaseAdmin),
);

// --- Público (postulante) ---------------------------------------------

export async function verificarCorreo(
  req: Request,
  res: Response<{ message: string }>,
): Promise<void> {
  const { correo, courseId } = req.body as VerificarCorreoInput;
  await uniformVerification(()=>solicitudService.verificarCorreo(correo,courseId));
  res.status(200).json({ message: MENSAJE_VERIFICACION_CORREO });
}

export async function confirmarCodigo(
  req: Request,
  res: Response<ConfirmarCodigoResult>,
): Promise<void> {
  const { correo, codigo } = req.body as { correo: string; codigo: string };
  const result = await solicitudService.confirmarCodigo(correo, codigo);
  res.status(200).json(result);
}

export async function completarDatos(
  req: Request,
  res: Response<CompletarDatosResult>,
): Promise<void> {
  const result = await solicitudService.completarDatos(
    req.params.id,
    req.body as unknown,
  );
  res.status(200).json(result);
}

export async function subirDocumento(
  req: Request,
  res: Response<SolicitudDocumentoResult>,
): Promise<void> {
  if (!req.file) {
    throw new AppError('El archivo es obligatorio (campo "archivo")', 400, {
      code: 'ARCHIVO_INVALIDO',
    });
  }
  const { buffer, mimetype, originalname } = req.file;
  res.status(201).json(
    await solicitudService.subirCertificado(
      req.params.id,
      { buffer, mimetype, originalname },
      req.body as unknown,
    ),
  );
}

// --- Admin ---------------------------------------------------------------

function requireAdminId(req: Request): string {
  if (!req.user) {
    throw new AppError('Authentication required', 401);
  }
  return req.user.id;
}

const adminService = new SolicitudAdminService(supabaseAdmin);

export async function listarSolicitudes(req: Request, res: Response): Promise<void> {
  const estado = req.query.estado as AdminEstadoLista | undefined;
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const result = await adminService.listar(
    estado,
    q,
    Number(req.query.page ?? 1),
    Number(req.query.pageSize ?? 20),
  );
  res.set('Cache-Control', 'no-store').status(200).json(result);
}

export async function detalleSolicitud(req: Request, res: Response): Promise<void> {
  res.set('Cache-Control', 'no-store').json(await adminService.detalle(req.params.id));
}

export async function registrarVerificacion(req: Request, res: Response): Promise<void> {
  const result = await adminService.registrarVerificacion(
    req.params.id,
    requireAdminId(req),
    req.body as unknown,
  );
  res.set('Cache-Control', 'no-store').status(201).json(result);
}

const decisionService = new SolicitudDecisionService(supabaseAdmin, new EmailService(mailer));

export async function decisionSolicitud(req: Request, res: Response): Promise<void> {
  const result = await decisionService.decidir(
    req.params.id,
    requireAdminId(req),
    req.body as unknown,
  );
  res.set('Cache-Control', 'no-store').status(200).json(result);
}

export async function certificadoUrl(req: Request, res: Response): Promise<void> {
  const result = await adminService.urlCertificado(req.params.id, requireAdminId(req));
  res.set('Cache-Control', 'no-store').json(result);
}

const privacyService = new SolicitudPrivacyService(supabaseAdmin);
export function avisoPrivacidad(_req: Request, res: Response): void {
  res.set('Cache-Control', 'no-store').json(privacyNotice());
}
export async function progresoSolicitud(req: Request, res: Response): Promise<void> {
  const progress=await privacyService.progress(req.params.id);
  res.json({...progress,puedeEditar:req.solicitudScope==='edicion'&&['borrador','devuelta'].includes(progress.estado)});
}

export async function aceptarConsentimiento(req: Request, res: Response): Promise<void> {
  res.json(await privacyService.accept(req.params.id, req.body as unknown));
}


export async function documentoUrl(req: Request, res: Response): Promise<void> {
  res.json(await new SolicitudDocumentAccessService(supabaseAdmin).url(req.params.id, req.params.docId, requireAdminId(req)));
}

export async function eliminarSolicitud(req: Request, res: Response): Promise<void> {
  await new SolicitudDeletionService(supabaseAdmin).remove(req.params.id, requireAdminId(req));
  res.status(204).send();
}

export async function enviarSolicitud(req: Request, res: Response): Promise<void> {
  res.json(await solicitudService.enviar(req.params.id));
}

export async function reenviarSolicitud(req: Request, res: Response): Promise<void> {
  res.json(await solicitudService.reenviar(req.params.id));
}

export async function resumenSolicitudes(_req:Request,res:Response):Promise<void>{res.json(await solicitudService.resumen());}
