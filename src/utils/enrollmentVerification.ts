import {
  NIVELES_ESTUDIOS,
  metodoHabilitaAprobacion,
  type MetodoVerificacion,
  type NivelEstudios,
  type TipoVerificacion,
} from '../config/enrollmentCatalog';

export interface VerificationRecord {
  tipo: TipoVerificacion;
  metodo: string;
  resultado: string;
  creado_at: string;
}

export interface VerificationContext {
  nivel: string | null;
  datosActualizadosAt: string | null;
  // Fecha de subida del certificado vigente (o el último que hubo); null si no hay certificado.
  certificadoSubidoAt: string | null;
}

export function isKnownLevel(nivel: string | null): nivel is NivelEstudios {
  return nivel !== null && Object.prototype.hasOwnProperty.call(NIVELES_ESTUDIOS, nivel);
}

// Una verificación solo vale si es posterior al último cambio de datos y, para estudios, al
// certificado que revisó. Los datos de la solicitud no cambian mientras está enviada, pero sí
// entre una devolución y el reenvío.
export function isVerificationFresh(v: VerificationRecord, ctx: VerificationContext): boolean {
  if (!ctx.datosActualizadosAt) return false;
  const at = new Date(v.creado_at).getTime();
  if (at < new Date(ctx.datosActualizadosAt).getTime()) return false;
  if (v.tipo === 'estudios' && ctx.certificadoSubidoAt)
    return at >= new Date(ctx.certificadoSubidoAt).getTime();
  return true;
}

// Una verificación habilita la aprobación solo si dice «verificado», usa un método válido para
// el tipo y el nivel (revision_visual nunca) y está vigente.
export function verificationEnablesApproval(
  v: VerificationRecord | undefined,
  ctx: VerificationContext,
): boolean {
  if (v?.resultado !== 'verificado' || !isKnownLevel(ctx.nivel)) return false;
  return (
    metodoHabilitaAprobacion(v.tipo, ctx.nivel, v.metodo as MetodoVerificacion) &&
    isVerificationFresh(v, ctx)
  );
}

// La más reciente de cada tipo manda; el desempate por id lo resuelve quien ordena la lista.
export function latestVerification<T extends VerificationRecord>(
  list: readonly T[],
  tipo: TipoVerificacion,
): T | undefined {
  let latest: T | undefined;
  for (const v of list) {
    if (v.tipo !== tipo) continue;
    if (!latest || new Date(v.creado_at).getTime() >= new Date(latest.creado_at).getTime())
      latest = v;
  }
  return latest;
}
