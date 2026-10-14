import type { Database } from '../config/database.types';

export interface StudentListQuery {
  q?: string;
  activo?: boolean;
  courseId?: string;
  cohortId?: string;
  pendienteCohorte?: boolean;
  documentosPendientes?: boolean;
  incluirHistorial?: boolean;
  page: number;
  pageSize: number;
}

export interface StudentListResult extends Record<string, unknown> {
  items: {
    id: string;
    cedula: string;
    nombreCompleto: string;
    telefono: string | null;
    activo: boolean;
    createdAt: string;
    matchingEnrollments: {
      id: string;
      courseId: string;
      courseType: 'A' | 'B';
      cohortId: string | null;
      status: Database['public']['Tables']['enrollments']['Row']['status'];
    }[];
  }[];
  total: number;
  page: number;
  pageSize: number;
}
