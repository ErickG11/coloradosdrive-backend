export type ContentValue =
  string | number | boolean | null | ContentValue[] | { [key: string]: ContentValue | undefined };
export type ContentData = Record<string, ContentValue | undefined>;

export interface CourseSubjectRow extends Record<string, unknown> {
  id: string;
  course_id: string;
  title: string;
  description: string | null;
  order_index: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}
export interface CourseMaterialRow extends Record<string, unknown> {
  id: string;
  title: string;
  description: string | null;
  kind: 'archivo' | 'enlace' | 'texto';
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  url: string | null;
  body: string | null;
  is_published: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export interface SubjectItemRow extends Record<string, unknown> {
  id: string;
  subject_id: string;
  kind: 'material' | 'examen';
  material_id: string | null;
  exam_id: string | null;
  order_index: number;
  obligatorio: boolean;
}
export interface ItemAccessRuleRow extends Record<string, unknown> {
  id: string;
  item_id: string;
  target_type: 'cohorte' | 'estudiante';
  cohort_id: string | null;
  student_id: string | null;
  habilitado: boolean;
  opens_at: string | null;
  closes_at: string | null;
  max_attempts: number | null;
  extra_minutes: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
export interface MaterialProgressRow extends Record<string, unknown> {
  student_id: string;
  material_id: string;
  first_opened_at: string;
  completed_at: string | null;
}
export interface ContentAccessAuditRow extends Record<string, unknown> {
  id: string;
  actor_id: string;
  action: 'crear' | 'editar' | 'revocar' | 'intento_extra';
  item_id: string;
  target_type: 'cohorte' | 'estudiante';
  target_id: string;
  snapshot: ContentValue;
  created_at: string;
}
export interface ContentTable<R extends Record<string, unknown>, K extends keyof R> {
  Row: R;
  Insert: Pick<R, K> & Partial<R>;
  Update: Partial<R>;
  Relationships: [];
}

export interface ItemAccess extends ContentData {
  estado: 'no_habilitado' | 'programado' | 'abierto' | 'cerrado';
  fuente: 'estudiante' | 'cohorte' | 'ninguna';
  opens_at: string | null;
  closes_at: string | null;
  max_attempts: number | null;
  extra_minutes: number;
}
