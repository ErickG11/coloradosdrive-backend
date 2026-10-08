import type { CourseType } from '../config/database.types';
import type { Modalidad } from './practiceSlotGeneration.model';

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
      };
  courseType: CourseType;
  cohortId: string | null;
  automatic: boolean;
  practice: ManualPracticeInput;
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
}
