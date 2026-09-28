import type { Request, Response } from 'express';

import { mailer } from '../config/mailer';
import { supabaseAdmin } from '../config/supabase';
import type {
  CompletarDatosResult,
  ConfirmarCodigoResult,
  DecidirSolicitudInput,
  SolicitudAdminView,
  SolicitudDatosInput,
  SolicitudDocumentoResult,
  SolicitudEstado,
  SolicitudTipoDocumento,
  VerificarCorreoInput,
} from '../models/solicitud.model';
import { AccountService } from '../services/account.service';
import { CohortAssignmentService } from '../services/cohortAssignment.service';
import { EmailService } from '../services/email.service';
import { SolicitudService, type DecidirSolicitudResult } from '../services/solicitud.service';
import { AppError } from '../utils/AppError';

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
  await solicitudService.verificarCorreo(correo, courseId);
  res.status(200).json({ message: 'Te enviamos un código de verificación a tu correo' });
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
    req.body as SolicitudDatosInput,
  );
  res.status(200).json(result);
}

export async function subirDocumento(
  req: Request,
  res: Response<SolicitudDocumentoResult>,
): Promise<void> {
  if (!req.file) {
    throw new AppError('El archivo es obligatorio (campo "archivo")', 400);
  }

  const result = await solicitudService.subirDocumento(
    req.params.id,
    (req.body as { tipo_documento: SolicitudTipoDocumento }).tipo_documento,
    { buffer: req.file.buffer, mimetype: req.file.mimetype, size: req.file.size },
  );
  res.status(201).json(result);
}

// --- Admin ---------------------------------------------------------------

function requireAdminId(req: Request): string {
  if (!req.user) {
    throw new AppError('Authentication required', 401);
  }
  return req.user.id;
}

export async function listarSolicitudes(
  req: Request,
  res: Response<SolicitudAdminView[]>,
): Promise<void> {
  const estado = req.query.estado as SolicitudEstado | undefined;
  res.status(200).json(await solicitudService.listarParaAdmin(estado));
}

export async function revisarDocumento(
  req: Request,
  res: Response<{ id: string; estado: 'aprobado' | 'rechazado' }>,
): Promise<void> {
  const { estado, motivoRechazo } = req.body as {
    estado: 'aprobado' | 'rechazado';
    motivoRechazo?: string;
  };
  const result = await solicitudService.revisarDocumento(req.params.id, req.params.docId, {
    estado,
    motivoRechazo,
  });
  res.status(200).json(result);
}

export async function decidirSolicitud(
  req: Request,
  res: Response<DecidirSolicitudResult>,
): Promise<void> {
  const adminId = requireAdminId(req);
  const result = await solicitudService.decidir(
    req.params.id,
    adminId,
    req.body as DecidirSolicitudInput,
  );
  res.status(200).json(result);
}
