export const PRACTICE_SLOT_STATUSES = [
  'disponible',
  'asignado',
  'confirmado',
  'liberado',
  'sin_practica',
  'completado',
] as const;
export type PracticeSlotStatus = (typeof PRACTICE_SLOT_STATUSES)[number];

// Refleja la tabla `practice_slots` (migración 005). Relación 1:1
// franja-estudiante: studentId es null salvo en asignado/confirmado/
// completado (ver practice_slots_student_status_consistency).
export interface PracticeSlot {
  id: string;
  cohortId: string;
  instructorId: string;
  studentId: string | null;
  scheduledAt: string;
  durationMinutes: number;
  status: PracticeSlotStatus;
  confirmationNotifiedAt: string | null;
  releaseNotifiedAt: string | null;
  confirmedAt: string | null;
  attended: boolean | null;
  createdAt: string;
  updatedAt: string;
}

// Forma que devuelven los 3 listados (admin/estudiante/instructor, ver
// PracticeSlotService): instructorName siempre presente (instructorId es
// NOT NULL), studentName null cuando no hay estudiante asignado. Evita
// que cada rol tenga que resolver nombres ajenos por su cuenta contra
// /users (ver docs/adr/008).
export interface PracticeSlotWithNames extends PracticeSlot {
  instructorName: string;
  studentName: string | null;
}

// 'verde': sin estudiante asignado (disponible/liberado), o estados fuera
// del ciclo activo (sin_practica/completado). 'rojo'/'amarillo'/'neutro':
// posición de esta franja dentro del rango completo de franjas
// asignadas/confirmadas de su propio estudiante en esta cohorte (ver
// PracticeSlotService.attachColorSemana) - calculado al vuelo en cada
// respuesta, nunca persistido, para que no quede desactualizado.
export const COLORES_SEMANA = ['verde', 'rojo', 'amarillo', 'neutro'] as const;
export type ColorSemana = (typeof COLORES_SEMANA)[number];

// Forma que devuelve específicamente el listado de admin (GET
// /practice-slots con rol admin) - el único que necesita colorSemana.
export interface PracticeSlotWithColor extends PracticeSlotWithNames {
  colorSemana: ColorSemana;
}

// RF-03: el admin crea la franja sin estudiante (status inicial
// 'disponible' se aplica en el service, no se acepta por input).
export interface CreatePracticeSlotInput {
  cohortId: string;
  instructorId: string;
  scheduledAt: string;
  durationMinutes?: 60;
}

// Solo los datos de programación de la franja - nunca studentId ni
// status, que cambian por acciones dedicadas (reclamar/confirmar/
// cancelar/marcar asistencia), no por una edición administrativa
// directa. Editar solo se permite si status = 'disponible' (se valida
// en el service, no aquí).
export type UpdatePracticeSlotInput = Partial<{
  instructorId: string;
  scheduledAt: string;
  durationMinutes: 60;
}>;

export interface SubmitAttendanceInput {
  attended: boolean;
}
