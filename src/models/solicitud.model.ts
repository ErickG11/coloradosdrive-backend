import type {
  SolicitudDocumentoEstado,
  SolicitudEstado,
  SolicitudTipoDocumento,
} from '../config/database.types';

export const SOLICITUD_ESTADOS = ['pendiente_revision', 'aprobada', 'rechazada'] as const;

export const TIPOS_DOCUMENTO = [
  'cedula',
  'papeleta_votacion',
  'tipo_sangre',
  'titulo_bachiller',
] as const;

export const DOCUMENTO_ESTADOS_REVISION = ['aprobado', 'rechazado'] as const;

// Edad (en años cumplidos) desde la cual la papeleta de votación no aplica.
export const EDAD_EXENCION_PAPELETA = 65;

export type { SolicitudDocumentoEstado, SolicitudEstado, SolicitudTipoDocumento };

// 'faltante': el postulante todavía no subió ese tipo. 'no_aplica': la
// papeleta de votación para mayores de 65 años (solo presentación en el
// checklist del admin; no bloquea nada).
export type ChecklistEstado = SolicitudDocumentoEstado | 'faltante' | 'no_aplica';

export interface ChecklistItem {
  tipoDocumento: SolicitudTipoDocumento;
  estado: ChecklistEstado;
  documentoId: string | null;
  url: string | null;
  motivoRechazo: string | null;
  uploadedAt: string | null;
  reviewedAt: string | null;
}

// Otra solicitud (de cualquier estado) que comparte cédula con la que se
// está mostrando. Puramente informativo: el sistema no decide nada por su
// cuenta, solo le da al admin visibilidad de un posible conflicto (mismo
// número de cédula, distinto correo, alguna rechazada) para que él evalúe
// si es la misma persona reintentando o un intento de suplantación.
export interface SolicitudRelacionada {
  id: string;
  correo: string;
  estado: SolicitudEstado;
  createdAt: string;
}

export interface VerificarCorreoInput {
  correo: string;
  courseId: string;
}

export interface SolicitudAdminView {
  id: string;
  courseId: string;
  cedula: string | null;
  nombreCompleto: string | null;
  telefono: string | null;
  correo: string;
  fechaNacimiento: string | null;
  correoVerificado: boolean;
  estado: SolicitudEstado;
  motivoRechazo: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  studentId: string | null;
  createdAt: string;
  documentos: ChecklistItem[];
  solicitudesRelacionadas: SolicitudRelacionada[];
}

export interface SolicitudDatosInput {
  cedula: string;
  nombreCompleto: string;
  telefono?: string;
  fechaNacimiento: string;
}

export interface ConfirmarCodigoResult {
  solicitudId: string;
  token: string;
}

export interface CompletarDatosResult {
  solicitudId: string;
  // Si la solicitud reemplazó un registro rechazado con otro id, el token
  // anterior deja de servir: se devuelve uno nuevo para el id vigente.
  token: string;
}

export interface SolicitudDocumentoResult {
  id: string;
  tipoDocumento: SolicitudTipoDocumento;
  estado: SolicitudDocumentoEstado;
  uploadedAt: string;
}

export interface DecidirSolicitudInput {
  estado: 'aprobada' | 'rechazada';
  motivoRechazo?: string;
}

export interface UploadedFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}
