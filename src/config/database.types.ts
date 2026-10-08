// Tipos manuales del esquema public, reflejando migrations/001_init.sql,
// 002_enrollments_monto.sql y 006_matricula_v2_schema.sql. Se pasan a
// createClient<Database>() para que el cliente de Supabase tipe
// correctamente cada query (sin esto, cada columna resuelve a `any`).
//
// `Relationships: []` es obligatorio en cada tabla (lo exige el tipo
// GenericTable de @supabase/postgrest-js); queda vacío en todas salvo en
// practice_slots, que sí declara sus 2 FKs hacia users (ver docs/adr/008)
// para poder embeber instructor/estudiante tipado en el listado, en vez
// de exponer un endpoint más amplio para resolver nombres por rol.

export type UserRole = 'admin' | 'estudiante' | 'instructor';
export type StudentStatus =
  | 'pendiente_verificacion'
  | 'verificado'
  | 'pagado_esperando_cohorte'
  | 'activo'
  | 'rechazado'
  | 'expirado';
export type SolicitudEstado = 'pendiente_revision' | 'aprobada' | 'rechazada';
export type SolicitudTipoDocumento =
  'cedula' | 'papeleta_votacion' | 'tipo_sangre' | 'titulo_bachiller';
export type SolicitudDocumentoEstado = 'recibido' | 'aprobado' | 'rechazado';
export type CourseType = 'A' | 'B';
export type EnrollmentStatus = 'activo' | 'finalizado' | 'retirado' | 'pendiente_cohorte';
export type ExamType = 'practica' | 'definitivo';
export type QuestionType = 'opcion_multiple' | 'texto_abierto';
export type AttemptStatus = 'en_progreso' | 'completado';
export type PracticeSlotStatus =
  'disponible' | 'asignado' | 'confirmado' | 'liberado' | 'sin_practica' | 'completado';

export interface Database {
  public: {
    Views: Record<string, never>;
    Functions: {
      practice_free_instructors: {
        Args: { p_scheduled_ats: string[]; p_instructor_id?: string };
        Returns: { id: string; nombre_completo: string }[];
      };
      act_on_practice_slot: {
        Args: { p_slot_id: string; p_student_id: string; p_action: 'claim' | 'confirm' | 'cancel' };
        Returns: Database['public']['Tables']['practice_slots']['Row'][];
      };
      practice_slots_scheduler_candidates: {
        Args: { p_transition: 'remind' | 'close' | 'complete' };
        Returns: {
          slot: Database['public']['Tables']['practice_slots']['Row'];
          row_version: string;
        }[];
      };
      transition_practice_slot_for_scheduler: {
        Args: { p_slot_id: string; p_transition: 'remind' | 'close' | 'complete'; p_expected_version: string };
        Returns: Database['public']['Tables']['practice_slots']['Row'][];
      };
    };
    Tables: {
      users: {
        Row: {
          id: string;
          cedula: string;
          nombre_completo: string;
          telefono: string | null;
          rol: UserRole;
          status: StudentStatus | null;
          debe_cambiar_password: boolean;
          fecha_nacimiento: string | null;
          tipo_sangre: string | null;
          genero: string | null;
          ciudadania: string | null;
          direccion: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          cedula: string;
          nombre_completo: string;
          telefono?: string | null;
          rol: UserRole;
          status?: StudentStatus | null;
          debe_cambiar_password?: boolean;
          fecha_nacimiento?: string | null;
          tipo_sangre?: string | null;
          genero?: string | null;
          ciudadania?: string | null;
          direccion?: string | null;
        };
        Update: Partial<{
          cedula: string;
          nombre_completo: string;
          telefono: string | null;
          rol: UserRole;
          status: StudentStatus | null;
          debe_cambiar_password: boolean;
          fecha_nacimiento: string | null;
          tipo_sangre: string | null;
          genero: string | null;
          ciudadania: string | null;
          direccion: string | null;
        }>;
        Relationships: [];
      };
      courses: {
        Row: {
          id: string;
          nombre: string;
          tipo: CourseType;
          descripcion: string | null;
          horas_requeridas: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          nombre: string;
          tipo: CourseType;
          descripcion?: string | null;
          horas_requeridas?: number | null;
        };
        Update: Partial<{
          nombre: string;
          tipo: CourseType;
          descripcion: string | null;
          horas_requeridas: number | null;
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
          fecha_inicio_matricula: string;
          fecha_fin_matricula: string;
          fecha_inicio_curso: string;
          fecha_fin_curso: string;
          tipo_modalidad: string | null;
          horarios_capacitacion_teoria: string | null;
          numero_vehiculos: number | null;
          numero_aulas: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          course_id: string;
          nombre: string;
          precio: number;
          cupo_maximo: number;
          fecha_inicio_matricula: string;
          fecha_fin_matricula: string;
          fecha_inicio_curso: string;
          fecha_fin_curso: string;
          tipo_modalidad?: string | null;
          horarios_capacitacion_teoria?: string | null;
          numero_vehiculos?: number | null;
          numero_aulas?: number | null;
        };
        Update: Partial<{
          course_id: string;
          nombre: string;
          precio: number;
          cupo_maximo: number;
          fecha_inicio_matricula: string;
          fecha_fin_matricula: string;
          fecha_inicio_curso: string;
          fecha_fin_curso: string;
          tipo_modalidad: string | null;
          horarios_capacitacion_teoria: string | null;
          numero_vehiculos: number | null;
          numero_aulas: number | null;
        }>;
        Relationships: [];
      };
      enrollments: {
        Row: {
          id: string;
          student_id: string;
          cohort_id: string | null;
          status: EnrollmentStatus;
          monto_total: string | null;
          descuento: string;
          monto_abonado: string;
          horas_practica_objetivo: number | null;
          fecha_inscripcion: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          cohort_id: string | null;
          status?: EnrollmentStatus;
          monto_total: number | null;
          descuento?: number;
          monto_abonado?: number;
          horas_practica_objetivo?: number | null;
        };
        Update: Partial<{
          cohort_id: string | null;
          status: EnrollmentStatus;
          monto_total: number | null;
          descuento: number;
          monto_abonado: number;
          horas_practica_objetivo: number | null;
        }>;
        Relationships: [];
      };
      exams: {
        Row: {
          id: string;
          course_id: string;
          title: string;
          type: ExamType;
          time_limit_minutes: number;
          passing_score_percent: string;
          is_published: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          course_id: string;
          title: string;
          type: ExamType;
          time_limit_minutes: number;
          passing_score_percent: number;
          is_published?: boolean;
        };
        Update: Partial<{
          title: string;
          time_limit_minutes: number;
          passing_score_percent: number;
          is_published: boolean;
        }>;
        Relationships: [];
      };
      questions: {
        Row: {
          id: string;
          exam_id: string;
          type: QuestionType;
          prompt: string;
          order_index: number;
          points: string;
          correct_answer_text: string | null;
          synonyms: string[] | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          exam_id: string;
          type: QuestionType;
          prompt: string;
          order_index: number;
          points: number;
          correct_answer_text?: string | null;
          synonyms?: string[] | null;
        };
        Update: Partial<{
          type: QuestionType;
          prompt: string;
          order_index: number;
          points: number;
          correct_answer_text: string | null;
          synonyms: string[] | null;
        }>;
        Relationships: [];
      };
      question_options: {
        Row: {
          id: string;
          question_id: string;
          option_text: string;
          is_correct: boolean;
          order_index: number;
        };
        Insert: {
          id?: string;
          question_id: string;
          option_text: string;
          is_correct?: boolean;
          order_index: number;
        };
        Update: Partial<{
          option_text: string;
          is_correct: boolean;
          order_index: number;
        }>;
        Relationships: [];
      };
      exam_attempts: {
        Row: {
          id: string;
          exam_id: string;
          student_id: string;
          status: AttemptStatus;
          score_percent: string | null;
          passed: boolean | null;
          started_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          exam_id: string;
          student_id: string;
          status?: AttemptStatus;
          score_percent?: number | null;
          passed?: boolean | null;
          started_at?: string;
          completed_at?: string | null;
        };
        Update: Partial<{
          status: AttemptStatus;
          score_percent: number | null;
          passed: boolean | null;
          completed_at: string | null;
        }>;
        Relationships: [];
      };
      attempt_answers: {
        Row: {
          id: string;
          attempt_id: string;
          question_id: string;
          selected_option_id: string | null;
          text_answer: string | null;
          is_correct: boolean;
          similarity_score: string | null;
        };
        Insert: {
          id?: string;
          attempt_id: string;
          question_id: string;
          selected_option_id?: string | null;
          text_answer?: string | null;
          is_correct: boolean;
          similarity_score?: number | null;
        };
        Update: Partial<{
          is_correct: boolean;
          similarity_score: number | null;
        }>;
        Relationships: [];
      };
      practice_slots: {
        Row: {
          id: string;
          cohort_id: string;
          instructor_id: string;
          student_id: string | null;
          scheduled_at: string;
          duration_minutes: number;
          status: PracticeSlotStatus;
          confirmation_notified_at: string | null;
          release_notified_at: string | null;
          confirmed_at: string | null;
          attended: boolean | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          cohort_id: string;
          instructor_id: string;
          student_id?: string | null;
          scheduled_at: string;
          duration_minutes?: number;
          status?: PracticeSlotStatus;
          confirmation_notified_at?: string | null;
          release_notified_at?: string | null;
          confirmed_at?: string | null;
          attended?: boolean | null;
        };
        Update: Partial<{
          instructor_id: string;
          scheduled_at: string;
          duration_minutes: number;
          student_id: string | null;
          status: PracticeSlotStatus;
          confirmation_notified_at: string | null;
          release_notified_at: string | null;
          confirmed_at: string | null;
          attended: boolean | null;
        }>;
        // Nombres de constraint por defecto de Postgres para `references
        // users (id)` inline en la migración 005 (`<tabla>_<columna>_fkey`,
        // sin nombre explícito) - necesarios para desambiguar cuál FK usar
        // al embeber (`users!practice_slots_instructor_id_fkey(...)`),
        // porque hay 2 FKs de esta tabla hacia la misma `users`.
        Relationships: [
          {
            foreignKeyName: 'practice_slots_instructor_id_fkey';
            columns: ['instructor_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'practice_slots_student_id_fkey';
            columns: ['student_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      solicitudes_inscripcion: {
        Row: {
          id: string;
          course_id: string;
          cedula: string | null;
          nombre_completo: string | null;
          telefono: string | null;
          correo: string;
          fecha_nacimiento: string | null;
          correo_verificado: boolean;
          codigo_verificacion: string | null;
          codigo_expira_at: string | null;
          intentos_codigo: number;
          estado: SolicitudEstado;
          motivo_rechazo: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          student_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          course_id: string;
          cedula?: string | null;
          nombre_completo?: string | null;
          telefono?: string | null;
          correo: string;
          fecha_nacimiento?: string | null;
          correo_verificado?: boolean;
          codigo_verificacion?: string | null;
          codigo_expira_at?: string | null;
          intentos_codigo?: number;
          estado?: SolicitudEstado;
        };
        Update: Partial<{
          course_id: string;
          cedula: string | null;
          nombre_completo: string | null;
          telefono: string | null;
          correo: string;
          fecha_nacimiento: string | null;
          correo_verificado: boolean;
          codigo_verificacion: string | null;
          codigo_expira_at: string | null;
          intentos_codigo: number;
          estado: SolicitudEstado;
          motivo_rechazo: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          student_id: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      solicitud_documentos: {
        Row: {
          id: string;
          solicitud_id: string;
          tipo_documento: SolicitudTipoDocumento;
          storage_path: string;
          estado: SolicitudDocumentoEstado;
          motivo_rechazo: string | null;
          uploaded_at: string;
          reviewed_at: string | null;
        };
        Insert: {
          id?: string;
          solicitud_id: string;
          tipo_documento: SolicitudTipoDocumento;
          storage_path: string;
          estado?: SolicitudDocumentoEstado;
        };
        Update: Partial<{
          storage_path: string;
          estado: SolicitudDocumentoEstado;
          motivo_rechazo: string | null;
          uploaded_at: string;
          reviewed_at: string | null;
        }>;
        Relationships: [];
      };
    };
  };
}
