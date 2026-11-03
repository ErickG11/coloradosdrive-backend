import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequestHandler } from 'express';
import type { Database } from '../config/database.types';
import { supabaseAdmin } from '../config/supabase';
import { ESTADOS_INSCRIPCION } from '../config/enrollmentCatalog';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { verifySolicitudClaims } from '../utils/solicitudToken';

export function createSolicitudAuth(db: SupabaseClient<Database>): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const [scheme, token, extra] = (req.headers.authorization ?? '').split(' ');
    const claims = scheme === 'Bearer' && token && !extra ? verifySolicitudClaims(token) : null;
    if (!claims)
      throw new AppError('Verifica tu correo para continuar.', 401, {
        code: 'TOKEN_INVALIDO_O_VENCIDO',
      });
    if (claims.solicitudId !== req.params.id)
      throw new AppError('El token no corresponde a esta solicitud.', 403, {
        code: 'ACCESO_DENEGADO',
      });
    const { data: row, error } = await db
      .from('solicitudes_inscripcion')
      .select('id,estado,correo_verificado')
      .eq('id', claims.solicitudId)
      .maybeSingle();
    if (error)
      throw new AppError('No se pudo verificar la solicitud.', 503, {
        code: 'VERIFICACION_NO_DISPONIBLE',
      });
    if (!row?.correo_verificado)
      throw new AppError('Verifica tu correo para continuar.', 401, {
        code: 'TOKEN_INVALIDO_O_VENCIDO',
      });
    if (!(ESTADOS_INSCRIPCION as readonly string[]).includes(row.estado))
      throw new AppError('Estado de solicitud no disponible.', 503, {
        code: 'VERIFICACION_NO_DISPONIBLE',
      });
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (claims.scope !== 'edicion')
        throw new AppError('Verifica de nuevo tu correo para editar.', 403, {
          code: 'SCOPE_INSUFICIENTE',
        });
      if (!['borrador', 'devuelta'].includes(row.estado))
        throw new AppError('La solicitud ya no admite cambios.', 409, {
          code: row.estado === 'enviada' ? 'SOLICITUD_ENVIADA' : 'SOLICITUD_CERRADA',
        });
    }
    req.solicitudId = claims.solicitudId;
    req.solicitudScope = claims.scope;
    next();
  });
}
export const authenticateSolicitud = createSolicitudAuth(supabaseAdmin);
