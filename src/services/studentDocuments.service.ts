import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import {
  TIPOS_DOCUMENTO,
  type SolicitudTipoDocumento,
  type UploadedFile,
  type SolicitudDocumentoResult,
} from '../models/solicitud.model';
import { calcularEdad } from '../utils/solicitudAge';
import { solicitudError } from '../utils/solicitudError';
import { SolicitudDocumentStorage } from './solicitudDocumentStorage.service';
export const PHYSICAL_DOCUMENT_MAPPING = {
  cedula: 'cedula',
  papeleta_votacion: 'papeleta_votacion',
  tipo_sangre: 'tipo_sangre',
  titulo_bachiller: 'titulo_bachiller',
} as const;
export interface StudentDocument {
  tipo: SolicitudTipoDocumento;
  estado: 'sin_subir' | 'en_revision' | 'aprobado' | 'rechazado';
  motivoRechazo: string | null;
  uploadedAt: string | null;
  reviewedAt: string | null;
  obligatorio: boolean;
  exento: boolean;
  estadoFisico: string | null;
}
export class StudentDocumentsService {
  constructor(private readonly db: SupabaseClient<Database>) {}
  private async owner(
    studentId: string,
  ): Promise<{
    solicitud: Pick<
      Database['public']['Tables']['solicitudes_inscripcion']['Row'],
      'id' | 'estado'
    > | null;
    fechaNacimiento: string | null;
  }> {
    const user = await this.db
      .from('users')
      .select('activo,fecha_nacimiento,debe_cambiar_password')
      .eq('id', studentId)
      .eq('rol', 'estudiante')
      .maybeSingle();
    if (user.error) throw user.error;
    if (!user.data?.activo)
      throw solicitudError('La cuenta está inactiva', 403, 'ACCOUNT_INACTIVE');
    if (user.data.debe_cambiar_password)
      throw solicitudError(
        'Debes cambiar tu contraseña temporal antes de continuar',
        403,
        'PASSWORD_CHANGE_REQUIRED',
      );
    const row = await this.db
      .from('solicitudes_inscripcion')
      .select('id,estado')
      .eq('student_id', studentId)
      .eq('estado', 'aprobada')
      .maybeSingle();
    if (row.error) throw row.error;
    return { solicitud: row.data, fechaNacimiento: user.data.fecha_nacimiento };
  }
  async get(studentId: string): Promise<{ documentos: StudentDocument[]; puedeSubir: boolean }> {
    const owner = await this.owner(studentId);
    const docs = owner.solicitud
      ? await this.db.from('solicitud_documentos').select().eq('solicitud_id', owner.solicitud.id)
      : { data: [], error: null };
    if (docs.error) throw docs.error;
    const enrollments = await this.db
      .from('enrollments')
      .select('id')
      .eq('student_id', studentId)
      .in('status', ['activo', 'pendiente_cohorte']);
    if (enrollments.error) throw enrollments.error;
    const physical = enrollments.data.length
      ? await this.db
          .from('enrollment_documents')
          .select('tipo,estado')
          .in(
            'enrollment_id',
            enrollments.data.map((e) => e.id),
          )
      : { data: [], error: null };
    if (physical.error) throw physical.error;
    return {
      puedeSubir: Boolean(owner.solicitud),
      documentos: TIPOS_DOCUMENTO.map((tipo) => {
        const doc = docs.data.find((d) => d.tipo_documento === tipo),
          rows = physical.data.filter((d) => d.tipo === PHYSICAL_DOCUMENT_MAPPING[tipo]);
        return {
          tipo,
          estado: doc?.estado === 'recibido' ? 'en_revision' : (doc?.estado ?? 'sin_subir'),
          motivoRechazo: doc?.estado === 'rechazado' ? doc.motivo_rechazo : null,
          uploadedAt: doc?.uploaded_at ?? null,
          reviewedAt: doc?.reviewed_at ?? null,
          obligatorio: tipo === 'cedula' || tipo === 'titulo_bachiller',
          exento:
            tipo === 'papeleta_votacion' &&
            Boolean(owner.fechaNacimiento && calcularEdad(owner.fechaNacimiento) >= 65),
          estadoFisico: rows.length
            ? rows.some((d) => d.estado === 'pendiente')
              ? 'pendiente'
              : rows.every((d) => d.estado === 'no_aplica')
                ? 'no_aplica'
                : 'entregado'
            : null,
        };
      }),
    };
  }
  async upload(
    studentId: string,
    tipo: SolicitudTipoDocumento,
    file: UploadedFile,
  ): Promise<SolicitudDocumentoResult> {
    const owner = await this.owner(studentId);
    if (!owner.solicitud)
      throw solicitudError(
        'No hay una solicitud de inscripción vinculada. Contacta a la escuela.',
        409,
        'EXPEDIENTE_NO_DISPONIBLE',
      );
    return new SolicitudDocumentStorage(this.db).upload(owner.solicitud.id, tipo, file);
  }
}
