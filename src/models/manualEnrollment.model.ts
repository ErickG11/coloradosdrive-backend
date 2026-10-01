import type { CourseType } from '../config/database.types';
import type { Modalidad } from './practiceSlotGeneration.model';
import type { DocumentInput, InitialPayment } from '../utils/manualEnrollmentDetails';

export interface ManualPracticeInput {
  semanas: 1 | 2 | 3;
  modalidad: Modalidad;
  fechaInicio: string;
  fechaFin?: string;
  horasPorDia: number;
  horaDeseada: string;
  horaResuelta?: string;
  instructorId?: string;
}
export interface ManualEnrollmentInput {
  student:
    | { mode: 'existing'; id: string }
    | {
        mode: 'new';
        cedula: string;
        nombreCompleto: string;
        correo: string;
        telefono?: string;
        fechaNacimiento?: string;
      };
  courseType: CourseType;
  cohortId: string | null;
  automatic: boolean;
  practice: ManualPracticeInput;
  documentos?: DocumentInput[];
  pago?: InitialPayment;
}
export interface ManualEnrollmentResult {
  operationId: string;
  studentId: string;
  studentCreated: boolean;
  enrollmentId: string;
  courseId: string;
  courseType: CourseType;
  cohortId: string | null;
  status: 'activo' | 'pendiente_cohorte';
  slotsCreated: number;
  plan: Record<string, unknown>;
  emailStatus: 'pending' | 'sending' | 'sent' | 'failed';
  // Las operaciones confirmadas antes de 022 conservan su respuesta original.
  montoTotal?: number | null;
  descuento?: number;
  montoAbonado?: number;
  saldo?: number | null;
  documentosPendientes?: number;
}
