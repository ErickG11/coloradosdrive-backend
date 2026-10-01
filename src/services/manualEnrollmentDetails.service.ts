import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import type { DocumentInput, InitialPayment } from '../utils/manualEnrollmentDetails';
import { validateDocumentUpdates } from '../utils/manualEnrollmentDetails';
import { AppError } from '../utils/AppError';
import { manualEnrollmentError } from './manualEnrollment.service';

export interface ManualEnrollmentDetails {
  enrollmentId: string;
  studentId: string;
  cohortId: string | null;
  montoTotal: number | null;
  descuento: number;
  precioBruto: number | null;
  montoAbonado: number;
  saldo: number | null;
  documentosPendientes: number;
  documentos: {
    tipo: string;
    estado: string;
    fechaMarcado: string | null;
    marcadoPor: string | null;
  }[];
}

export class ManualEnrollmentDetailsService {
  constructor(private readonly db: SupabaseClient<Database>) {}

  async get(id: string): Promise<ManualEnrollmentDetails> {
    const { data: enrollment, error } = await this.db.from('enrollments')
      .select('id,student_id,cohort_id,monto_total,descuento,monto_abonado')
      .eq('id', id).maybeSingle();
    if (error) throw error;
    if (!enrollment) throw new AppError('Matrícula no encontrada', 404);
    const { data: documents, error: documentsError } = await this.db
      .from('enrollment_documents').select()
      .eq('enrollment_id', id).order('tipo');
    if (documentsError) throw documentsError;
    const net = enrollment.monto_total === null ? null : Number(enrollment.monto_total);
    const discount = Number(enrollment.descuento);
    const paid = Number(enrollment.monto_abonado);
    return {
      enrollmentId: enrollment.id,
      studentId: enrollment.student_id,
      cohortId: enrollment.cohort_id,
      montoTotal: net,
      descuento: discount,
      precioBruto: net === null ? null : net + discount,
      montoAbonado: paid,
      saldo: net === null ? null : Math.round((net - paid) * 100) / 100,
      documentosPendientes: documents.filter((document) => document.estado === 'pendiente').length,
      documentos: documents.map((document) => ({
        tipo: document.tipo,
        estado: document.estado,
        fechaMarcado: document.fecha_marcado,
        marcadoPor: document.marcado_por,
      })),
    };
  }

  async update(actor: string, id: string, fields: {
    documentos?: DocumentInput[];
    pago?: InitialPayment;
  }): Promise<ManualEnrollmentDetails> {
    if (fields.documentos) validateDocumentUpdates(fields.documentos);
    const { error } = await this.db.rpc('update_manual_enrollment_details', {
      p_enrollment: id,
      p_actor: actor,
      p_documents: fields.documentos ?? null,
      p_payment: fields.pago ?? null,
    });
    if (error) throw manualEnrollmentError(error);
    return this.get(id);
  }
}
