// Tipos manuales del esquema public, reflejando migrations/001_init.sql y
// 002_enrollments_monto.sql. Se pasan a createClient<Database>() para que
// el cliente de Supabase tipe correctamente cada query (sin esto, cada
// columna resuelve a `any`).
//
// `Relationships: []` es obligatorio en cada tabla (lo exige el tipo
// GenericTable de @supabase/postgrest-js); queda vacío porque no hacemos
// selects anidados/embebidos vía foreign keys en este proyecto.

export type UserRole = 'admin' | 'estudiante' | 'instructor';
export type CourseType = 'A' | 'B';
export type EnrollmentStatus = 'activo' | 'finalizado' | 'retirado';

export interface Database {
  public: {
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Tables: {
      users: {
        Row: {
          id: string;
          cedula: string;
          nombre_completo: string;
          telefono: string | null;
          rol: UserRole;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          cedula: string;
          nombre_completo: string;
          telefono?: string | null;
          rol: UserRole;
        };
        Update: Partial<{
          cedula: string;
          nombre_completo: string;
          telefono: string | null;
          rol: UserRole;
        }>;
        Relationships: [];
      };
      courses: {
        Row: {
          id: string;
          nombre: string;
          tipo: CourseType;
          descripcion: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          nombre: string;
          tipo: CourseType;
          descripcion?: string | null;
        };
        Update: Partial<{
          nombre: string;
          tipo: CourseType;
          descripcion: string | null;
        }>;
        Relationships: [];
      };
      cohorts: {
        Row: {
          id: string;
          course_id: string;
          nombre: string;
          precio: string;
          cupo_maximo: number;
          fecha_inicio: string;
          fecha_fin: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          course_id: string;
          nombre: string;
          precio: number;
          cupo_maximo: number;
          fecha_inicio: string;
          fecha_fin: string;
        };
        Update: Partial<{
          course_id: string;
          nombre: string;
          precio: number;
          cupo_maximo: number;
          fecha_inicio: string;
          fecha_fin: string;
        }>;
        Relationships: [];
      };
      enrollments: {
        Row: {
          id: string;
          student_id: string;
          cohort_id: string;
          status: EnrollmentStatus;
          monto_total: string;
          fecha_inscripcion: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          cohort_id: string;
          status?: EnrollmentStatus;
          monto_total: number;
        };
        Update: Partial<{
          status: EnrollmentStatus;
        }>;
        Relationships: [];
      };
    };
  };
}
