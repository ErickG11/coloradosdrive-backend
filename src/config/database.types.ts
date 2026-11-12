import type { IdentityDocument } from '../utils/identityDocument';
import type {
  RequestReviewState,
  RequestRetentionPolicy,
  RequestEmailClaim,
} from '../models/requestReview.model';
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
import type { BillingState, BillingClaim } from '../models/billing.model';
import type {
  PlanChangeState,
  PlanChangePreview,
  BulkReassignmentResult,
  AdminReassignmentSource,
  PlanChangeCalendar,
} from '../models/planChange.model';
import type { IndividualEnrollmentAccess } from '../models/individualEnrollmentAccess.model';
import type {
  FoundationFields,
  EnrollmentFoundationColumns,
  ReservationFoundationColumns,
  CohortFoundationColumns,
  FoundationReadOnlyTable,
  CourseTypePriceRow,
  EnrollmentRuleFlagRow,
  EnrollmentPlanOptionRow,
  EnrollmentPermissionRow,
  EnrollmentAuditRow,
  EnrollmentFunnelRow,
} from '../models/enrollmentFoundation.model';
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

import type {
  ContentData,
  ContentValue,
  ContentTable,
  CourseSubjectRow,
  CourseMaterialRow,
  SubjectItemRow,
  ItemAccessRuleRow,
  MaterialProgressRow,
  ContentAccessAuditRow,
} from '../models/content.model';
import type { StudentPayment, PaymentRow } from '../models/studentPayment.model';
import type { StudentScheduleReservation } from '../models/studentSchedule.model';
import type { StudentListResult } from '../models/studentAdmin.model';
import type { NotificationRow } from '../models/notification.model';
import type { AttendanceEventRow, PracticeHistoryResult } from '../models/practiceAttendance.model';
import type {
  InstructorRatingDetail,
  InstructorRatingSummary,
  PracticeRatingPage,
  PracticeRatingPendingItem,
  PracticeRatingSubmission,
} from '../models/practiceRating.model';
import type {
  CancellationCategory,
  CancellationOutcome,
  CancellationPreview,
  PracticeCancellationRpcResult,
  ReleasedPracticeSlot,
  PendingPracticeRpcSlot,
  SwapPracticeRpcResult,
} from '../models/practiceSlot.model';
import type { PracticeRecovery } from '../services/studentAccess.service';
import type { StudentDeletionOperation } from '../services/studentDeletion.service';
import type { StudentProfileResult } from '../services/studentProfile.service';
import type {
  EnrollmentSummaryRow,
  EnrollmentReservation,
  EnrollmentDraftReservation,
} from '../models/enrollmentLimits.model';

export type UserRole = 'admin' | 'estudiante' | 'instructor';
export type StudentStatus =
  | 'pendiente_verificacion'
  | 'verificado'
  | 'pagado_esperando_cohorte'
  | 'activo'
  | 'rechazado'
  | 'expirado';
export type SolicitudEstado =
  | 'pendiente_revision'
  | 'borrador'
  | 'enviada'
  | 'devuelta'
  | 'aprobada'
  | 'rechazada'
  | 'archivada';
export type SolicitudTipoDocumento =
  'cedula' | 'papeleta_votacion' | 'tipo_sangre' | 'titulo_bachiller' | 'certificado_estudios';
export type SolicitudDocumentoEstado = 'recibido' | 'aprobado' | 'rechazado';
export type CourseType = 'A' | 'B';
export type EnrollmentStatus =
  'activo' | 'finalizado' | 'retirado' | 'anulada' | 'pendiente_cohorte';
export type ExamType = 'practica' | 'definitivo';
export type QuestionType = 'opcion_multiple' | 'texto_abierto';
export type AttemptStatus = 'en_progreso' | 'completado';
export type PracticeSlotStatus =
  'disponible' | 'asignado' | 'confirmado' | 'liberado' | 'sin_practica' | 'completado';

export interface ManualOperation extends Record<string, unknown> {
  id: string;
  actor_id: string;
  request_hash: string;
  worker_id: string;
  phase: 'processing' | 'failed' | 'needs_review' | 'committed';
  student_id: string | null;
  student_created: boolean;
  response: Record<string, unknown> | null;
  email_status: 'pending' | 'sending' | 'sent' | 'failed';
  created_at: string;
  updated_at: string;
}

export interface Database {
  public: {
    Views: {
      solicitudes_admin: {
        Row: Database['public']['Tables']['solicitudes_inscripcion']['Row'] & {
          documentos_por_revisar: number;
          orden_grupo: number;
          pendiente_desde: string | null;
          decidida_at: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      maintain_waitlist_v12: { Args: Record<string, never>; Returns: undefined };
      schedule_unavailable_v12: {
        Args: { p_student: string; p_enrollment: string; p_input: Record<string, unknown> };
        Returns: {
          codigo: 'SIN_CURSOS_ABIERTOS' | 'SIN_FECHAS_COMPATIBLES' | 'SIN_HORAS_LIBRES';
          mensaje: string;
          primeraFechaPosible: null;
          ultimaFechaInicioPosible: string | null;
        };
      };

      identity_documents_v2: {
        Args: { p_actor: string; p_students: string[] };
        Returns: Record<string, IdentityDocument>;
      };
      find_manual_students_v2: {
        Args: { p_actor: string; p_query: string };
        Returns: {
          id: string;
          cedula: string | null;
          nombre_completo: string;
          correo: string;
          documentType: IdentityDocument['type'];
          documentNumber: string;
        }[];
      };

      student_payment_statuses_v2: {
        Args: { p_actor: string; p_students: string[] };
        Returns: Record<string, string>;
      };
      assert_identity_permission_v2: { Args: { p_actor: string }; Returns: undefined };
      retry_request_emails_v2: {
        Args: { p_actor: string; p_id: string; p_reason: string };
        Returns: number;
      };
      request_review_v2: {
        Args: { p_actor: string; p_id: string; p_claim?: boolean };
        Returns: RequestReviewState;
      };
      register_request_verification_v2: {
        Args: {
          p_actor: string;
          p_id: string;
          p_token: string;
          p_type: string;
          p_method: string;
          p_result: string;
          p_note: string;
          p_mode: string;
          p_scan?: Json;
        };
        Returns: Record<string, unknown>;
      };
      revoke_request_approval_v2: {
        Args: { p_actor: string; p_id: string; p_version: string; p_reason: string };
        Returns: RequestReviewState;
      };
      request_retention_config_v2: {
        Args: Record<string, never>;
        Returns: RequestRetentionPolicy | null;
      };
      set_request_retention_v2: {
        Args: { p_actor: string; p_policy: Json; p_reason: string };
        Returns: RequestRetentionPolicy;
      };
      claim_request_email_v2: { Args: Record<string, never>; Returns: RequestEmailClaim | null };
      finish_request_email_v2: {
        Args: { p_id: string; p_token: string; p_sent: boolean };
        Returns: boolean;
      };
      mark_verification_scan_deleted_v2: {
        Args: { p_id: string; p_path: string };
        Returns: boolean;
      };

      billing_state_v2: {
        Args: { p_student: string; p_actor?: string | null };
        Returns: BillingState;
      };
      save_billing_profile_v2: {
        Args: { p_student: string; p_profile: Json; p_actor?: string | null };
        Returns: BillingState;
      };
      claim_billing_v2: { Args: Record<string, never>; Returns: BillingClaim | null };
      finish_billing_v2: {
        Args: { p_document: string; p_token: string; p_result: string };
        Returns: boolean;
      };
      admin_billing_action_v2: {
        Args: {
          p_actor: string;
          p_document: string;
          p_version: string;
          p_action: string;
          p_data: Json;
        };
        Returns: BillingState;
      };
      document_refund_v2: {
        Args: {
          p_actor: string;
          p_payment: string;
          p_key: string;
          p_amount: number;
          p_reason: string;
          p_reference: string;
        };
        Returns: BillingState;
      };

      student_plan_change_calendar_v2: {
        Args: {
          p_student: string;
          p_enrollment: string;
          p_month: string;
          p_mode: string;
          p_hours: number;
        };
        Returns: PlanChangeCalendar;
      };
      admin_plan_change_calendar_v2: {
        Args: {
          p_actor: string;
          p_enrollment: string;
          p_month: string;
          p_mode: string;
          p_hours: number;
          p_target: string | null;
        };
        Returns: PlanChangeCalendar;
      };
      release_admin_plan_change_v2: {
        Args: { p_actor: string; p_student: string; p_reservation: string };
        Returns: StudentScheduleReservation;
      };
      preview_admin_plan_change_v2: {
        Args: {
          p_actor: string;
          p_enrollment: string;
          p_input: Record<string, unknown>;
          p_reason: string;
          p_target: string | null;
        };
        Returns: PlanChangePreview;
      };

      assert_reassignment_permission_v2: { Args: { p_actor: string }; Returns: undefined };
      cohort_reassignment_source_v2: {
        Args: { p_actor: string; p_cohort: string };
        Returns: AdminReassignmentSource;
      };
      student_plan_change_state_v2: {
        Args: { p_student: string; p_enrollment: string };
        Returns: PlanChangeState;
      };
      admin_plan_change_state_v2: {
        Args: { p_actor: string; p_enrollment: string };
        Returns: PlanChangeState;
      };
      preview_student_plan_change_v2: {
        Args: { p_student: string; p_enrollment: string; p_input: Record<string, unknown> };
        Returns: PlanChangePreview;
      };
      reserve_student_plan_change_v2: {
        Args: { p_student: string; p_enrollment: string; p_input: Record<string, unknown> };
        Returns: StudentScheduleReservation;
      };
      reserve_admin_plan_change_v2: {
        Args: {
          p_actor: string;
          p_enrollment: string;
          p_input: Record<string, unknown>;
          p_reason: string;
          p_target: string | null;
        };
        Returns: StudentScheduleReservation;
      };
      confirm_student_plan_change_v2: {
        Args: { p_student: string; p_reservation: string };
        Returns: StudentScheduleReservation;
      };
      confirm_admin_plan_change_v2: {
        Args: { p_actor: string; p_reservation: string };
        Returns: StudentScheduleReservation;
      };
      bulk_reassign_enrollments_v2: {
        Args: {
          p_actor: string;
          p_changes: Record<string, unknown>[];
          p_reason: string;
          p_preview: boolean;
        };
        Returns: BulkReassignmentResult;
      };
      cancel_cohort_v2: {
        Args: { p_actor: string; p_cohort: string; p_version: string; p_reason: string };
        Returns: { id: string; cancelled: boolean };
      };

      retry_waitlist_emails_v2: {
        Args: { p_actor: string; p_type: 'A' | 'B'; p_reason: string };
        Returns: number;
      };
      set_enrollment_waitlist_v2: {
        Args: {
          p_student: string;
          p_type: 'A' | 'B';
          p_preference: Record<string, unknown> | null;
          p_remove: boolean;
        };
        Returns: { registered: boolean; registeredAt?: string };
      };
      get_enrollment_waitlist_v2: {
        Args: { p_student: string };
        Returns: {
          active: boolean;
          types: Partial<Record<'A' | 'B', { registeredAt: string }>>;
          enrollments?: { id: string; type: 'A' | 'B' }[];
        };
      };
      preview_waitlist_event_v2: {
        Args: { p_actor: string; p_cohort: string };
        Returns: { count: number; type?: 'A' | 'B'; day?: string };
      };
      enqueue_waitlist_event_v2: { Args: { p_actor: string; p_cohort: string }; Returns: number };
      admin_waitlist_counts_v2: {
        Args: { p_actor: string };
        Returns: { active: boolean; A: number; B: number };
      };
      list_admin_waitlist_students_v2: {
        Args: { p_actor: string; p_type: 'A' | 'B'; p_filters: Record<string, unknown> };
        Returns: StudentListResult;
      };

      admin_enrollment_access_v2: {
        Args: { p_actor: string; p_student: string };
        Returns: IndividualEnrollmentAccess;
      };
      student_enrollment_access_v2: {
        Args: { p_student: string };
        Returns: IndividualEnrollmentAccess;
      };
      extend_enrollment_access_v2: {
        Args: { p_actor: string; p_enrollment: string; p_end: string; p_reason: string };
        Returns: { id: string; accessEndDate: string };
      };
      authorize_repeat_enrollment_v2: {
        Args: { p_actor: string; p_student: string; p_course: string; p_reason: string };
        Returns: string;
      };

      write_cohort_v2: {
        Args: {
          p_actor: string;
          p_id: string | null;
          p_version: string | null;
          p_input: Record<string, unknown>;
          p_reason: string;
        };
        Returns: Database['public']['Tables']['cohorts']['Row'];
      };
      cohort_admin_config_v2: {
        Args: { p_actor: string };
        Returns: {
          active: boolean;
          serverNow?: string;
          vehiculos?: number | null;
          prices?: { tipo: 'A' | 'B'; centavos: number }[];
          pricesActive?: boolean;
          capacityActive?: boolean;
        };
      };
      set_course_type_price_v2: {
        Args: { p_actor: string; p_type: 'A' | 'B'; p_cents: number; p_reason: string };
        Returns: undefined;
      };
      set_vehicle_capacity_v2: {
        Args: { p_actor: string; p_count: number; p_reason: string };
        Returns: { vehiculos: number; horasSobreLimite: number };
      };

      enrollment_metrics_v2: {
        Args: { p_actor: string };
        Returns: { active: boolean; counts?: Record<string, number>; serverNow?: string };
      };
      record_schedule_choice_v2: {
        Args: { p_student: string; p_enrollment: string };
        Returns: undefined;
      };
      enrollment_job_heartbeat_v2: {
        Args: { p_job: string; p_result: string; p_disabled?: boolean };
        Returns: undefined;
      };
      monitor_enrollment_rules_v2: { Args: Record<string, never>; Returns: number };
      report_enrollment_security_v2: { Args: { p_actor: string }; Returns: undefined };
      assert_enrollment_permission_v2: {
        Args: { p_actor: string; p_permission: string };
        Returns: undefined;
      };
      manual_plan_preview_v2: {
        Args: { p_actor: string; p_type: CourseType; p_input: Json; p_student: string | null };
        Returns: {
          plan: Json;
          cohort: Database['public']['Tables']['cohorts']['Row'];
          courseId: string;
          precioCentavos: number;
          instructors: { id: string; nombreCompleto: string }[];
          serverNow: string;
        };
      };
      student_schedule_calendar_v2: {
        Args: {
          p_student: string;
          p_enrollment: string;
          p_month: string;
          p_mode: string;
          p_hours: number;
        };
        Returns: {
          serverNow: string;
          calendarEndDate?: string | null;
          dias: { fecha: string; disponible: boolean; motivo?: string | null }[];
        };
      };

      claim_payment_reconciliation: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          token: string;
          reference: string | null;
          dispatched: boolean;
        } | null;
      };
      finish_payment_reconciliation: {
        Args: { p_id: string; p_token: string; p_result: string };
        Returns: boolean;
      };

      student_schedule_preview_v2: {
        Args: {
          p_student: string;
          p_enrollment: string;
          p_input: {
            modalidad: string;
            fechaInicio: string;
            horasPorDia: number;
            horaInicio: number;
          };
        };
        Returns: {
          conflict?: { course: string; date: string; hour: string; message: string };
          factible: boolean;
          diasFallan: string[];
          serverNow: string;
          precioCentavos: number | null;
        };
      };

      exam_question_image: {
        Args: {
          p_actor: string;
          p_exam: string;
          p_question: string | null;
          p_action: string;
          p_data: ContentData;
        };
        Returns: ContentValue;
      };
      content_admin: {
        Args: { p_actor: string; p_action: string; p_data: ContentData };
        Returns: ContentValue;
      };
      content_student: {
        Args: { p_student: string; p_action: string; p_data: ContentData };
        Returns: ContentValue;
      };
      content_start_attempt: { Args: { p_student: string; p_exam: string }; Returns: ContentValue };
      content_attempt_state: {
        Args: { p_student: string; p_attempt: string };
        Returns: ContentValue;
      };
      content_exam_access: { Args: { p_student: string; p_exam: string }; Returns: ContentValue };
      content_finish_attempt: {
        Args: { p_student: string; p_attempt: string; p_answers: ContentValue };
        Returns: ContentValue;
      };
      begin_student_payment: {
        Args: {
          p_student: string;
          p_reserva: string;
          p_proveedor: string;
          p_attempt: string;
          p_recargo: number;
          p_gracia: number;
          p_actor?: string;
          p_comprobante?: string;
        };
        Returns: StudentPayment;
      };
      claim_payment_dispatch: { Args: { p_id: string }; Returns: boolean };
      record_payment_reference: {
        Args: { p_id: string; p_proveedor: string; p_referencia: string };
        Returns: undefined;
      };
      confirm_student_payment: {
        Args: {
          p_id: string;
          p_proveedor: string;
          p_referencia: string | null;
          p_resultado: string;
          p_total: number;
          p_moneda: string;
          p_event: string;
          p_hash: string;
        };
        Returns: StudentPayment;
      };
      admin_release_student_reservation: {
        Args: { p_actor: string; p_reserva: string };
        Returns: StudentScheduleReservation;
      };
      claim_payment_email: { Args: { p_id: string }; Returns: string | null };
      finish_payment_email: {
        Args: { p_id: string; p_token: string; p_ok: boolean };
        Returns: boolean;
      };

      student_schedule_free_slots: {
        Args: { p_slots: string[] };
        Returns: { scheduled_at: string; libre: boolean }[];
      };
      reserve_student_schedule: {
        Args: {
          p_student: string;
          p_enrollment: string;
          p_slots: string[];
          p_modalidad: string;
          p_inicio: string;
          p_horas: number;
          p_ttl: number;
          p_max_dia: number;
          p_margen: number;
        };
        Returns: StudentScheduleReservation;
      };
      manage_student_reservation: {
        Args: {
          p_student: string;
          p_accion: 'actual' | 'ampliar' | 'liberar' | 'iniciar_pago';
          p_id?: string;
          p_extension: number;
          p_max_extensiones: number;
          p_gracia: number;
        };
        Returns: StudentScheduleReservation | null;
      };
      expire_student_reservations: { Args: { p_student: string }; Returns: number };

      cohort_cupos_ocupados: {
        Args: { p_cohorts: string[] };
        Returns: { cohort_id: string; ocupados: number }[];
      };

      tomar_recuperacion_aprobacion: {
        Args: { p_intento: string; p_ttl: number; p_forzar?: boolean };
        Returns: { intentoId: string; solicitudId: string; token: string } | null;
      };
      cerrar_recuperacion_aprobacion: {
        Args: { p_intento: string; p_token: string };
        Returns: boolean;
      };
      liberar_reclamo_aprobacion_legacy: {
        Args: { p_id: string; p_claim: string; p_ttl: number };
        Returns: boolean;
      };
      // F14 (SQL050): verificaciones del admin y listado con búsqueda escapada.
      registrar_verificacion_inscripcion: {
        Args: {
          p_id: string;
          p_actor: string;
          p_tipo: string;
          p_metodo: string;
          p_resultado: string;
          p_nota: string | null;
          p_habilita: boolean;
        };
        Returns: {
          id: string;
          tipo: 'identidad' | 'estudios';
          metodo: string;
          resultado: 'verificado' | 'no_coincide' | 'no_encontrado';
          nota: string | null;
          createdAt: string;
        } | null;
      };
      // F15 (SQL051): decisiones del admin.
      devolver_solicitud_inscripcion: {
        Args: {
          p_id: string;
          p_actor: string;
          p_motivo: string;
          p_mensaje: string;
          p_nota: string | null;
        };
        Returns: { id: string; estado: 'devuelta'; correo: string } | null;
      };
      rechazar_solicitud_inscripcion: {
        Args: {
          p_id: string;
          p_actor: string;
          p_motivo: string;
          p_mensaje: string;
          p_nota: string | null;
          p_bloqueo_hash: string | null;
          p_bloqueo_dias: number | null;
        };
        Returns: { id: string; estado: 'rechazada'; correo: string } | null;
      };
      validar_aprobacion_inscripcion: {
        Args: {
          p_id: string;
          p_verif_identidad: string | null;
          p_verif_estudios: string | null;
          p_version_aviso: string;
          p_version_terminos: string;
        };
        Returns: undefined;
      };
      // F16 (SQL052): aprobación en dos pasos.
      reclamar_aprobacion_inscripcion: {
        Args: {
          p_id: string;
          p_actor: string;
          p_verif_identidad: string | null;
          p_verif_estudios: string | null;
          p_version_aviso: string;
          p_version_terminos: string;
        };
        Returns: {
          claim: string;
          correo: string;
          courseId: string;
          solicitadaAt: string;
          authUserId: string;
        } | null;
      };
      finalizar_aprobacion_inscripcion: {
        Args: {
          p_id: string;
          p_actor: string;
          p_claim: string;
          p_student: string;
          p_cohort: string | null;
          p_estado: string;
          p_monto: number | null;
        };
        Returns: { studentId: string; enrollmentId: string } | null;
      };
      // F20 (SQL053): vencimientos y huérfanos.
      vencer_solicitudes_devueltas: {
        Args: { p_dias: number; p_mensaje: string };
        Returns: number | null;
      };
      listar_objetos_huerfanos_solicitudes: {
        Args: { p_antes: string; p_limite: number };
        Returns: string[] | null;
      };
      listar_solicitudes_admin: {
        Args: { p_estado: string | null; p_q: string | null; p_page: number; p_size: number };
        Returns: {
          items: Record<string, unknown>[];
          total: number;
          page: number;
          pageSize: number;
        } | null;
      };
      enviar_solicitud_inscripcion: {
        Args: {
          p_id: string;
          p_modo: 'enviar' | 'reenviar';
          p_version_aviso: string;
          p_version_terminos: string;
        };
        Returns: { id: string; estado: 'enviada'; enviadaAt: string; transicion: boolean } | null;
      };
      guardar_certificado_inscripcion: {
        Args: {
          p_id: string;
          p_nivel: string;
          p_marca: string;
          p_subtipo: string;
          p_ruta: string;
          p_mime: string;
          p_tamano: number;
          p_sha256: string;
          p_version_aviso: string;
          p_version_terminos: string;
        };
        Returns: {
          id: string;
          subtipo: string;
          mimeType: string;
          tamano: number;
          subidoAt: string;
          rutaAnterior: string | null;
        } | null;
      };
      guardar_datos_inscripcion: {
        Args: {
          p_id: string;
          p_datos: Record<string, unknown>;
          p_version_aviso: string;
          p_version_terminos: string;
        };
        Returns: { id: string; datosActualizadosAt: string | null } | null;
      };
      aceptar_consentimiento_inscripcion: {
        Args: {
          p_id: string;
          p_version_aviso: string;
          p_version_terminos: string;
          p_representante?: boolean;
        };
        Returns: {
          version: string;
          versionAviso: string;
          versionTerminos: string;
          aceptadoAt: string;
        } | null;
      };
      emitir_codigo_inscripcion: {
        Args: {
          p_correo: string;
          p_curso: string;
          p_codigo_hash: string;
          p_expira: string;
          p_correo_hash: string;
          p_topes: Record<string, number>;
        };
        Returns: {
          emitir?: boolean;
          correo?: string;
          id?: string;
          motivo?: 'cerradas' | 'limite';
        } | null;
      };
      confirmar_codigo_inscripcion: {
        Args: {
          p_correo: string;
          p_codigo_hash: string;
          p_correo_hash: string;
          p_topes: Record<string, number>;
        };
        Returns: {
          resultado: 'valido' | 'invalido' | 'limite';
          id?: string;
          scope?: 'edicion' | 'estado';
        } | null;
      };
      enviar_solicitud: {
        Args: { p_id: string; p_version: string };
        Returns: { id: string; estado: string; enviadaAt: string };
      };
      correo_tiene_cuenta: { Args: { p_correo: string }; Returns: boolean };
      resumen_solicitudes: { Args: Record<string, never>; Returns: EnrollmentSummaryRow | null };
      reservar_limite_inscripcion: {
        Args: {
          p_operacion: string;
          p_ip_hash: string | null;
          p_correo_hash: string | null;
          p_topes: Record<string, number>;
          p_solicitud?: string | null;
        };
        Returns: EnrollmentReservation | null;
      };
      crear_borrador_limitado: {
        Args: {
          p_correo: string;
          p_curso: string;
          p_codigo: string;
          p_expira: string;
          p_topes: Record<string, number>;
        };
        Returns: EnrollmentDraftReservation | null;
      };
      actualizar_config_inscripcion: {
        Args: { p_actor: string; p_abiertas: boolean };
        Returns: { inscripcionesAbiertas: boolean } | null;
      };
      revisar_documento_solicitud: {
        Args: {
          p_solicitud: string;
          p_documento: string;
          p_actor: string;
          p_estado: string;
          p_motivo: string | null;
        };
        Returns: { id: string; estado: 'aprobado' | 'rechazado' };
      };
      eliminar_solicitud_reclamada: {
        Args: { p_solicitud: string; p_claim: string; p_actor: string | null; p_accion: string };
        Returns: undefined;
      };
      finalizar_aprobacion_solicitud: {
        Args: {
          p_solicitud: string;
          p_actor: string;
          p_claim: string;
          p_student: string;
          p_enrollment: string;
        };
        Returns: undefined;
      };
      list_student_pending_practice_ratings: {
        Args: { p_student: string; p_page: number; p_page_size: number };
        Returns: PracticeRatingPage<PracticeRatingPendingItem>;
      };
      submit_practice_rating: {
        Args: { p_slot: string; p_student: string; p_score: number; p_comment: string | null };
        Returns: PracticeRatingSubmission;
      };
      list_admin_instructor_ratings: {
        Args: { p_actor: string; p_page: number; p_page_size: number };
        Returns: PracticeRatingPage<InstructorRatingSummary>;
      };
      admin_instructor_rating_detail: {
        Args: { p_actor: string; p_instructor: string; p_page: number; p_page_size: number };
        // 036 agrega distribution al contrato JSON del detalle administrativo.
        Returns: InstructorRatingDetail;
      };
      register_practice_attendance: {
        Args: { p_slot: string; p_actor: string; p_attended: boolean };
        Returns: Database['public']['Tables']['practice_slots']['Row'][];
      };
      correct_practice_attendance: {
        Args: { p_slot: string; p_actor: string; p_attended: boolean; p_motivo: string };
        Returns: Database['public']['Tables']['practice_slots']['Row'][];
      };
      list_practice_attendance_events: {
        Args: { p_actor: string; p_slot: string; p_page: number; p_page_size: number };
        Returns: { items: AttendanceEventRow[]; total: number };
      };
      student_practice_history: {
        Args: { p_student: string; p_enrollment: string; p_page: number; p_page_size: number };
        Returns: PracticeHistoryResult;
      };
      list_user_notifications: {
        Args: { p_user: string; p_page: number; p_page_size: number };
        Returns: { items: NotificationRow[]; total: number; unreadCount: number };
      };
      mark_user_notification_read: {
        Args: { p_user: string; p_id: string };
        Returns: NotificationRow[];
      };
      read_all_user_notifications: { Args: { p_user: string }; Returns: number };
      claim_notification_email: { Args: Record<string, never>; Returns: NotificationRow[] };
      finish_notification_email: {
        Args: { p_id: string; p_token: string; p_error: string | null };
        Returns: boolean;
      };
      assign_pending_enrollment_cohort: {
        Args: {
          p_actor: string;
          p_student: string;
          p_enrollment: string;
          p_cohort: string;
          p_cohort_version: string;
          p_validated_day: string;
        };
        Returns: Database['public']['Tables']['enrollments']['Row'];
      };
      begin_student_deletion: {
        Args: { p_actor: string; p_student: string; p_confirmation: string | null };
        Returns: StudentDeletionOperation;
      };
      advance_student_deletion: {
        Args: {
          p_actor: string;
          p_student: string;
          p_phase: string;
          p_version: string;
          p_next: string;
        };
        Returns: StudentDeletionOperation;
      };
      student_deletion_storage_paths: {
        Args: { p_actor: string; p_student: string };
        Returns: string[];
      };
      delete_student_data: {
        Args: { p_actor: string; p_student: string; p_version: string; p_cleaned_paths: string[] };
        Returns: StudentDeletionOperation;
      };
      set_student_active: {
        Args: { p_actor: string; p_student: string; p_active: boolean };
        Returns: boolean;
      };
      restore_student_practice: {
        Args: { p_actor: string; p_student: string; p_slot: string };
        Returns: PracticeRecovery;
      };
      save_student_profile: {
        Args: {
          p_actor: string;
          p_student: string;
          p_operation: string;
          p_base_version: string;
          p_profile: Record<string, string | null>;
          p_email_changed: boolean;
        };
        Returns: StudentProfileResult;
      };
      list_admin_students: {
        Args: {
          p_actor: string;
          p_q: string | null;
          p_active: boolean | null;
          p_course: string | null;
          p_cohort: string | null;
          p_pending: boolean | null;
          p_documents_pending: boolean | null;
          p_history: boolean;
          p_page: number;
          p_page_size: number;
        };
        Returns: StudentListResult;
      };
      find_manual_students: {
        Args: { p_actor: string; p_query: string };
        Returns: { id: string; cedula: string; nombre_completo: string; correo: string }[];
      };
      reserve_manual_enrollment: {
        Args: { p_id: string; p_actor: string; p_hash: string; p_worker: string };
        Returns: ManualOperation & { claimed: boolean };
      };
      commit_manual_enrollment: {
        Args: {
          p_id: string;
          p_worker: string;
          p_student: string;
          p_profile: Record<string, unknown> | null;
          p_course: string;
          p_cohort: string | null;
          p_plan: Record<string, unknown>;
          p_scheduled_ats: string[];
          p_instructor: string | null;
          p_documents: { tipo: string; estado: string }[];
          p_payment: { modalidad: string; descuento: number; montoAbonado: number };
        };
        Returns: Record<string, unknown>;
      };
      update_manual_enrollment_details: {
        Args: {
          p_enrollment: string;
          p_actor: string;
          p_documents: { tipo: string; estado: string }[] | null;
          p_payment: { modalidad: string; descuento: number; montoAbonado: number } | null;
        };
        Returns: boolean;
      };
      claim_manual_enrollment_email: { Args: { p_id: string }; Returns: boolean };
      abort_manual_enrollment: {
        Args: { p_id: string; p_worker: string };
        Returns: ManualOperation;
      };
      practice_free_instructors: {
        Args: { p_scheduled_ats: string[]; p_instructor_id?: string };
        Returns: { id: string; nombre_completo: string }[];
      };
      set_instructor_active: {
        Args: { p_id: string; p_active: boolean };
        Returns: boolean;
      };
      act_on_practice_slot: {
        Args: { p_slot_id: string; p_student_id: string; p_action: 'claim' | 'confirm' };
        Returns: Database['public']['Tables']['practice_slots']['Row'][];
      };
      preview_practice_slot_cancellation: {
        Args: { p_slot_id: string; p_student_id: string };
        Returns: CancellationPreview;
      };
      cancel_practice_slot_with_reason: {
        Args: {
          p_slot_id: string;
          p_student_id: string;
          p_motivo_categoria: string;
          p_motivo_texto: string;
        };
        Returns: PracticeCancellationRpcResult;
      };
      released_practice_slots_for_student: {
        Args: { p_student_id: string };
        Returns: ReleasedPracticeSlot[];
      };
      pending_practice_slots_for_student: {
        Args: { p_student_id: string };
        Returns: PendingPracticeRpcSlot[];
      };
      swap_practice_slot: {
        Args: { p_slot_id: string; p_student_id: string; p_source_slot_id: string | null };
        Returns: SwapPracticeRpcResult;
      };
      practice_slots_scheduler_candidates: {
        Args: { p_transition: 'remind' | 'close' | 'complete' };
        Returns: {
          slot: Database['public']['Tables']['practice_slots']['Row'];
          row_version: string;
        }[];
      };
      transition_practice_slot_for_scheduler: {
        Args: {
          p_slot_id: string;
          p_transition: 'remind' | 'close' | 'complete';
          p_expected_version: string;
        };
        Returns: Database['public']['Tables']['practice_slots']['Row'][];
      };
      confirmar_identidad_presencial_admin: {
        Args: { p_student: string; p_actor: string; p_motivo: string };
        Returns: {
          transicion: boolean;
          confirmadaAt: string;
          confirmadaPor: string;
          enrollmentId: string;
        };
      };
      // B2 · F19
      confirmar_identidad_presencial: {
        Args: { p_slot: string; p_instructor: string; p_certificado_visto: boolean };
        Returns: { transicion: boolean; confirmadaAt: string; certificadoOriginalVisto: boolean };
      };
      franjas_identidad_pendiente: {
        Args: { p_instructor: string; p_slots: string[] };
        Returns: { slot_id: string; certificado_requerido: boolean }[];
      };
    };
    Tables: {
      course_type_prices: FoundationReadOnlyTable<CourseTypePriceRow>;
      enrollment_rule_flags: FoundationReadOnlyTable<EnrollmentRuleFlagRow>;
      enrollment_plan_options: FoundationReadOnlyTable<EnrollmentPlanOptionRow>;
      enrollment_admin_permissions: FoundationReadOnlyTable<EnrollmentPermissionRow>;
      enrollment_domain_audit: FoundationReadOnlyTable<EnrollmentAuditRow>;
      enrollment_funnel_events: FoundationReadOnlyTable<EnrollmentFunnelRow>;
      course_subjects: ContentTable<CourseSubjectRow, 'course_id' | 'title'>;
      course_materials: ContentTable<CourseMaterialRow, 'title' | 'kind'>;
      subject_items: ContentTable<SubjectItemRow, 'subject_id' | 'kind'>;
      item_access_rules: ContentTable<ItemAccessRuleRow, 'item_id' | 'target_type'>;
      material_progress: ContentTable<MaterialProgressRow, 'student_id' | 'material_id'>;
      content_access_audit: ContentTable<
        ContentAccessAuditRow,
        'actor_id' | 'action' | 'item_id' | 'target_type' | 'target_id' | 'snapshot'
      >;
      payments: { Row: PaymentRow; Insert: never; Update: never; Relationships: [] };
      payment_mail_outbox: {
        Row: {
          payment_id: string;
          estado: 'pendiente' | 'enviando' | 'enviado' | 'fallido';
          intentos: number;
          lease_token: string | null;
          lease_until: string | null;
          next_attempt_at: string;
          sent_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };

      student_schedule_reservations: {
        Row: FoundationFields<ReservationFoundationColumns> & {
          replacement_enrollment_id: string | null;
          id: string;
          student_id: string;
          enrollment_id: string;
          cohort_id: string;
          course_type: 'A' | 'B';
          estado: StudentScheduleReservation['estado'];
          creada_at: string;
          expira_at: string;
          extensiones: number;
          pago_iniciado_at: string | null;
          cerrada_at: string | null;
          modalidad: 'entre_semana' | 'fin_de_semana';
          fecha_inicio: string;
          horas_por_dia: number;
          margen_dias: number;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };

      solicitud_aprobacion_intentos: {
        Row: {
          id: string;
          solicitud_id: string;
          actor_id: string;
          claim: string;
          estado: 'pendiente' | 'recuperando' | 'completado' | 'compensado' | 'revision_manual';
          updated_at: string;
          resuelto_at: string | null;
          recovery_token: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      app_settings: {
        Row: {
          practicas_hora_fin: number;
          id: boolean;
          inscripciones_abiertas: boolean;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: { id?: boolean; inscripciones_abiertas?: boolean; updated_by?: string | null };
        Update: {
          inscripciones_abiertas?: boolean;
          updated_by?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      practice_attendance_events: {
        Row: AttendanceEventRow & { transaction_id: number };
        Insert: Omit<AttendanceEventRow, 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      notifications: {
        Row: NotificationRow;
        Insert: Pick<NotificationRow, 'user_id' | 'tipo' | 'titulo' | 'mensaje'> &
          Partial<NotificationRow>;
        Update: Partial<
          Pick<
            NotificationRow,
            | 'read_at'
            | 'email_status'
            | 'email_attempts'
            | 'email_last_error'
            | 'email_next_attempt_at'
            | 'email_lease_token'
            | 'email_locked_until'
          >
        >;
        Relationships: [];
      };
      practice_slot_cancellations: {
        Row: {
          id: string;
          slot_id: string;
          enrollment_id: string;
          student_id: string;
          instructor_id: string;
          cohort_id: string;
          slot_starts_at: string;
          cancelled_at: string;
          motivo_categoria: CancellationCategory;
          motivo_texto: string;
          resultado: CancellationOutcome;
          consumio_reprogramacion: boolean;
          reprogramacion_numero: number | null;
          origen: 'alumno' | 'cambio_cupo';
          repuesto_por_slot_id: string | null;
          repuesto_en: string | null;
        };
        Insert: Omit<
          Database['public']['Tables']['practice_slot_cancellations']['Row'],
          'id' | 'origen' | 'repuesto_por_slot_id' | 'repuesto_en'
        > & {
          id?: string;
          origen?: 'alumno' | 'cambio_cupo';
          repuesto_por_slot_id?: string | null;
          repuesto_en?: string | null;
        };
        Update: { repuesto_por_slot_id?: string; repuesto_en?: string };
        Relationships: [];
      };

      student_deletion_operations: {
        Row: StudentDeletionOperation;
        Insert: { student_id: string; actor_id: string };
        Update: never;
        Relationships: [];
      };
      student_access_audit: {
        Row: {
          id: string;
          student_id: string;
          actor_id: string;
          action: string;
          created_at: string;
        };
        Insert: { student_id: string; actor_id: string; action: string };
        Update: never;
        Relationships: [];
      };
      student_practice_recovery: {
        Row: {
          student_id: string;
          slot_id: string;
          cohort_id: string;
          instructor_id: string;
          scheduled_at: string;
          status: string;
          reason: string | null;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      student_profile_audit: {
        Row: {
          operation_id: string;
          actor_id: string;
          student_id: string;
          changed_fields: string[];
          created_at: string;
        };
        Insert: {
          operation_id: string;
          actor_id: string;
          student_id: string;
          changed_fields: string[];
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      manual_course_catalog: {
        Row: { tipo: CourseType; course_id: string };
        Insert: { tipo: CourseType; course_id: string };
        Update: Partial<{ tipo: CourseType; course_id: string }>;
        Relationships: [];
      };
      manual_enrollment_operations: {
        Row: ManualOperation;
        Insert: Pick<ManualOperation, 'id' | 'actor_id' | 'request_hash' | 'worker_id' | 'phase'>;
        Update: Partial<ManualOperation>;
        Relationships: [];
      };
      enrollment_documents: {
        Row: {
          enrollment_id: string;
          tipo: string;
          estado: string;
          fecha_marcado: string | null;
          marcado_por: string | null;
        };
        Insert: {
          enrollment_id: string;
          tipo: string;
          estado: string;
          fecha_marcado?: string | null;
          marcado_por?: string | null;
        };
        Update: Partial<{
          estado: string;
          fecha_marcado: string | null;
          marcado_por: string | null;
        }>;
        Relationships: [];
      };
      users: {
        Row: {
          identity_document_type: IdentityDocument['type'];
          identity_document_number: string;
          identity_access_blocked_at: string | null;
          billing_profile: Json;
          id: string;
          cedula: string | null;
          nombre_completo: string;
          telefono: string | null;
          rol: UserRole;
          status: StudentStatus | null;
          debe_cambiar_password: boolean;
          activo: boolean;
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
          activo?: boolean;
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
          activo: boolean;
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
          edad_minima: number;
          id: string;
          nombre: string;
          tipo: CourseType;
          descripcion: string | null;
          horas_requeridas: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          edad_minima?: number;
          id?: string;
          nombre: string;
          tipo: CourseType;
          descripcion?: string | null;
          horas_requeridas?: number | null;
        };
        Update: Partial<{
          edad_minima: number;
          nombre: string;
          tipo: CourseType;
          descripcion: string | null;
          horas_requeridas: number | null;
        }>;
        Relationships: [];
      };
      cohorts: {
        Row: FoundationFields<CohortFoundationColumns> & {
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
        Row: FoundationFields<EnrollmentFoundationColumns> & {
          cohort_assigned_by: string | null;
          cohort_assigned_at: string | null;
          id: string;
          course_id: string;
          course_type: CourseType;
          practice_plan: Record<string, unknown> | null;
          student_id: string;
          cohort_id: string | null;
          status: EnrollmentStatus;
          monto_total: string | null;
          descuento: string;
          monto_abonado: string;
          reprogramaciones_usadas: number;
          horas_practica_objetivo: number | null;
          fecha_inscripcion: string;
          origen: 'manual' | 'solicitud';
          etapa_inscripcion: 'por_agendar' | 'reservado' | 'activa';
          reserva_expira_at: string | null;
          requisitos_verificados_at: string | null;
          identidad_presencial_at: string | null;
          identidad_presencial_por: string | null;
          certificado_original_visto: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          course_id?: string;
          course_type?: CourseType;
          practice_plan?: Record<string, unknown> | null;
          student_id: string;
          cohort_id: string | null;
          status?: EnrollmentStatus;
          monto_total: number | null;
          descuento?: number;
          monto_abonado?: number;
          reprogramaciones_usadas?: number;
          horas_practica_objetivo?: number | null;
        };
        Update: Partial<{
          course_id: string;
          course_type: CourseType;
          practice_plan: Record<string, unknown> | null;
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
          max_attempts_default: number | null;
          shuffle_questions: boolean;
          shuffle_options: boolean;
          description: string | null;
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
          max_attempts_default?: number | null;
          shuffle_questions?: boolean;
          shuffle_options?: boolean;
          description?: string | null;
          id?: string;
          course_id: string;
          title: string;
          type: ExamType;
          time_limit_minutes: number;
          passing_score_percent: number;
          is_published?: boolean;
        };
        Update: Partial<{
          max_attempts_default: number | null;
          shuffle_questions: boolean;
          shuffle_options: boolean;
          description: string | null;
          title: string;
          time_limit_minutes: number;
          passing_score_percent: number;
          is_published: boolean;
        }>;
        Relationships: [];
      };
      questions: {
        Row: {
          image_path: string | null;
          image_alt: string | null;
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
          image_path?: string | null;
          image_alt?: string | null;
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
          image_path: string | null;
          image_alt: string | null;
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
          attempt_number: number;
          deadline_at: string;
          max_attempts_aplicado: number | null;
          minutos_aplicados: number;
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
          attempt_number: number;
          deadline_at: string;
          minutos_aplicados: number;
          max_attempts_aplicado?: number | null;
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
      solicitud_consentimientos: {
        Row: {
          representante_document_type: IdentityDocument['type'];
          representante_document_number: string | null;
          id: string;
          solicitud_id: string;
          version_aviso: string;
          version_terminos: string | null;
          acepto_terminos: boolean;
          representante_autoriza_tratamiento: boolean;
          acepto_tratamiento: boolean;
          declara_veracidad: boolean;
          aceptado_at: string;
          representante_nombre: string | null;
          representante_cedula: string | null;
          representante_acepta: boolean;
        };
        Insert: {
          solicitud_id: string;
          version_aviso: string;
          acepto_tratamiento: boolean;
          declara_veracidad: boolean;
          version_terminos?: string | null;
          acepto_terminos?: boolean;
          representante_autoriza_tratamiento?: boolean;
          representante_nombre?: string | null;
          representante_cedula?: string | null;
          representante_acepta?: boolean;
        };
        Update: Partial<Database['public']['Tables']['solicitud_consentimientos']['Insert']>;
        Relationships: [];
      };
      solicitud_auditoria: {
        Row: {
          id: string;
          solicitud_id: string;
          actor_id: string | null;
          accion: string;
          documento_id: string | null;
          creado_at: string;
        };
        Insert: {
          solicitud_id: string;
          actor_id?: string | null;
          accion: string;
          documento_id?: string | null;
        };
        Update: never;
        Relationships: [];
      };
      solicitudes_inscripcion: {
        Row: {
          identity_document_type: IdentityDocument['type'];
          identity_document_number: string | null;
          review_owner: string | null;
          review_until: string | null;
          updated_at: string;
          archived_at: string | null;
          linked_enrollment_id: string | null;
          revoked_at: string | null;
          revocation_payment_review: boolean;
          datos_actualizados_at: string | null;
          correo_normalizado: string;
          nombres: string | null;
          apellidos: string | null;
          nacionalidad_tipo: string | null;
          tipo_sangre: string | null;
          nivel_estudios: string | null;
          devuelta_at: string | null;
          devolucion_motivo_codigo: string | null;
          devolucion_mensaje: string | null;
          devuelta_por: string | null;
          devolucion_nota_interna: string | null;
          rechazo_nota_interna: string | null;
          rechazo_motivo_codigo: string | null;
          documento_estudios_pendiente_por_cupo: boolean;
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
          solicitada_at: string | null;
          enviada_at: string | null;
          created_at: string;
        };
        Insert: {
          enviada_at?: string | null;
          solicitada_at?: string | null;
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
          solicitada_at: string | null;
          enviada_at: string | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      solicitud_verificaciones: {
        Row: {
          mode: string | null;
          scan_path: string | null;
          scan_mime: string | null;
          scan_sha256: string | null;
          scan_size: number | null;
          scan_deleted_at: string | null;
          id: string;
          solicitud_id: string;
          tipo: 'identidad' | 'estudios';
          metodo: string;
          resultado: 'verificado' | 'no_coincide' | 'no_encontrado';
          nota: string | null;
          actor_id: string;
          creado_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      solicitud_documentos: {
        Row: {
          id: string;
          solicitud_id: string;
          tipo_documento: SolicitudTipoDocumento;
          // Las filas con archivo eliminado (retención) tienen storage_path NULL; los tipos
          // históricos lo declaran string: quien lo lea debe comprobarlo como string | null.
          storage_path: string;
          estado: SolicitudDocumentoEstado;
          motivo_rechazo: string | null;
          uploaded_at: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          // F14: campos del certificado de estudios (042).
          subtipo: string | null;
          mime_type: string | null;
          size_bytes: number | null;
          sha256: string | null;
          archivo_verificado_at: string | null;
          archivo_eliminado_at: string | null;
        };
        Insert: {
          id?: string;
          solicitud_id: string;
          tipo_documento: SolicitudTipoDocumento;
          storage_path: string;
          estado?: SolicitudDocumentoEstado;
        };
        Update: Partial<{
          storage_path: string | null;
          archivo_eliminado_at: string | null;
          estado: SolicitudDocumentoEstado;
          motivo_rechazo: string | null;
          uploaded_at: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
        }>;
        Relationships: [];
      };
    };
  };
}
