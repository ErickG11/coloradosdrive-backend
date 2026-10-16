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
    requirements?: { pending: string[]; unavailable: string[] };
    matchingEnrollments: {
      id: string;
      courseId: string;
      courseType: 'A' | 'B';
      cohortId: string | null;
      status: Database['public']['Tables']['enrollments']['Row']['status'];
    }[];
  }[];
  cohortSummary?: {
    id: string;
    name: string;
    activeStudents: number;
    matchingActiveStudents: number;
    usedCapacity: number;
    totalCapacity: number;
  } | null;
  total: number;
  page: number;
  pageSize: number;
}
