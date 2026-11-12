import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export interface MigrationEntry {
  id: string;
  file: string;
  operations: string | null;
}
// Lista revisada. 064 es un borrador local: nunca se descubre ni ejecuta.
export const MIGRATION_MANIFEST: readonly MigrationEntry[] = [
  { id: '001', file: '001_init.sql', operations: null },
  { id: '002', file: '002_enrollments_monto.sql', operations: null },
  { id: '003', file: '003_seed_courses.sql', operations: null },
  { id: '004', file: '004_exams.sql', operations: null },
  { id: '005', file: '005_practice_slots.sql', operations: null },
  { id: '006', file: '006_matricula_v2_schema.sql', operations: null },
  { id: '007', file: '007_solicitudes_inscripcion.sql', operations: null },
  { id: '008', file: '008_solicitudes_intentos_codigo.sql', operations: null },
  { id: '009', file: '009_enable_rls.sql', operations: null },
  { id: '010', file: '010_practice_slots_no_overlap.sql', operations: null },
  { id: '011', file: '011_realtime_broadcast_authorization.sql', operations: null },
  { id: '012', file: '012_cohorts_matricula_curso_fechas.sql', operations: null },
  { id: '013', file: '013_enrollment_status_pendiente_cohorte.sql', operations: null },
  { id: '014', file: '014_enrollments_pendiente_cohorte_shape_y_cupo.sql', operations: null },
  { id: '015', file: '015_solicitudes_course_id.sql', operations: null },
  { id: '016', file: '016_users_datos_estudiante_ampliados.sql', operations: null },
  { id: '017', file: '017_enrollments_pago_inicial.sql', operations: null },
  { id: '018', file: '018_practice_slots_integrity.sql', operations: 'cd-05-07' },
  { id: '019', file: '019_practice_slots_atomic_transitions.sql', operations: 'cd-05-07' },
  { id: '020', file: '020_matricula_manual_simplificada.sql', operations: null },
  { id: '021', file: '021_instructores_activos.sql', operations: null },
  {
    id: '022',
    file: '022_matricula_documentos_abono.sql',
    operations: 'matricula-documentos-abono',
  },
  { id: '023', file: '023_estudiantes_listado_ficha.sql', operations: 'estudiantes-a1' },
  { id: '024', file: '024_estudiantes_edicion.sql', operations: 'estudiantes-a2' },
  { id: '025', file: '025_estudiantes_acceso.sql', operations: 'estudiantes-b' },
  { id: '026', file: '026_estudiantes_eliminacion.sql', operations: 'estudiantes-d' },
  { id: '027', file: '027_estudiantes_asignacion_cohorte.sql', operations: 'estudiantes-c' },
  { id: '028', file: '028_estudiantes_busqueda_mejorada.sql', operations: 'estudiantes-busqueda' },
  { id: '029', file: '029_cohortes_validaciones.sql', operations: 'cohortes-validaciones' },
  { id: '030', file: '030_asistencia_cancelacion.sql', operations: 'asistencia-a' },
  { id: '031', file: '031_asistencia_cambio_cupo.sql', operations: 'asistencia-e2' },
  {
    id: '032',
    file: '032_asistencia_excluir_cupo_propio.sql',
    operations: 'asistencia-cupo-propio',
  },
  { id: '033', file: '033_asistencia_notificaciones.sql', operations: 'asistencia-e3' },
  { id: '034', file: '034_asistencia_auditoria.sql', operations: 'asistencia-e4' },
  { id: '035', file: '035_calificacion_instructores.sql', operations: 'rf04-a' },
  { id: '036', file: '036_distribucion_calificaciones_instructor.sql', operations: 'rf04-c' },
  { id: '037', file: '037_inscripcion_privacidad.sql', operations: 'inscripcion-037' },
  { id: '038', file: '038_solicitudes_aprobacion_atomica.sql', operations: 'inscripcion-038' },
  { id: '039', file: '039_solicitudes_eliminacion_atomica.sql', operations: 'inscripcion-039' },
  { id: '040', file: '040_solicitudes_envio.sql', operations: 'inscripcion-040' },
  { id: '041', file: '041_documentos_notificaciones.sql', operations: 'inscripcion-041' },
  { id: '042', file: '042_inscripcion_flujo_final.sql', operations: 'inscripcion-042' },
  { id: '043', file: '043_inscripcion_endurecimiento.sql', operations: 'inscripcion-043' },
  { id: '044', file: '044_inscripcion_limites.sql', operations: 'inscripcion-044' },
  { id: '045', file: '045_inscripcion_codigos.sql', operations: 'inscripcion-045' },
  {
    id: '046',
    file: '046_inscripcion_consentimiento_versionado.sql',
    operations: 'inscripcion-046',
  },
  { id: '047', file: '047_inscripcion_datos_atomicos.sql', operations: 'inscripcion-047' },
  { id: '048', file: '048_inscripcion_certificado_atomico.sql', operations: 'inscripcion-048' },
  { id: '049', file: '049_inscripcion_envio_atomico.sql', operations: 'inscripcion-049' },
  { id: '050', file: '050_inscripcion_verificaciones.sql', operations: 'inscripcion-050' },
  { id: '051', file: '051_inscripcion_decisiones.sql', operations: 'inscripcion-051' },
  { id: '052', file: '052_inscripcion_aprobacion.sql', operations: 'inscripcion-052' },
  { id: '053', file: '053_inscripcion_retencion.sql', operations: 'inscripcion-053' },
  { id: '054', file: '054_identidad_presencial.sql', operations: 'inscripcion-054' },
  { id: '055', file: '055_recuperacion_aprobaciones.sql', operations: 'inscripcion-055' },
  { id: '056', file: '056_identidad_presencial_admin.sql', operations: 'inscripcion-056' },
  { id: '057', file: '057_aprobacion_estado_matricula.sql', operations: 'inscripcion-057' },
  { id: '058', file: '058_alumno_etapas_matricula.sql', operations: 'inscripcion-058' },
  { id: '059', file: '059_alumno_reservas_horario.sql', operations: 'inscripcion-059' },
  { id: '060', file: '060_alumno_pagos_atomicos.sql', operations: 'inscripcion-060' },
  { id: '061', file: '061_alumnos_pendientes_solo_activa.sql', operations: 'inscripcion-061' },
  { id: '062', file: '062_pagos_sin_envio_vencidos.sql', operations: 'inscripcion-062' },
  { id: '063', file: '063_inscripcion_datos_obligatorios.sql', operations: 'inscripcion-063' },
  { id: '065', file: '065_contenido_examenes.sql', operations: 'examenes-065' },
  { id: '066a', file: '066a_contenido_api_funciones.sql', operations: 'examenes-066a' },
  { id: '066b', file: '066b_contenido_api_borrado_permisos.sql', operations: 'examenes-066b' },
  { id: '067', file: '067_examenes_imagenes_preguntas.sql', operations: 'examenes-067' },
  { id: '068', file: '068_inscripcion_modelo_base.sql', operations: 'inscripcion-068' },
  { id: '069', file: '069_inscripcion_backfill_trazable.sql', operations: 'inscripcion-069' },
  { id: '070', file: '070_inscripcion_reglas_calendario.sql', operations: 'inscripcion-070' },
  { id: '071', file: '071_inscripcion_reservas_capacidad.sql', operations: 'inscripcion-071' },
  { id: '072', file: '072_inscripcion_pagos_conciliacion.sql', operations: 'inscripcion-072' },
  { id: '073', file: '073_cohortes_administracion.sql', operations: 'inscripcion-073' },
  { id: '074', file: '074_matriculas_acceso_individual.sql', operations: 'inscripcion-074' },
  { id: '075', file: '075_lista_espera_notificaciones.sql', operations: 'inscripcion-075' },
  { id: '076', file: '076_cambio_plan_atomico.sql', operations: 'inscripcion-076' },
  { id: '077', file: '077_reasignacion_masiva_cancelacion.sql', operations: 'inscripcion-077' },
  { id: '078', file: '078_facturacion_cola_manual.sql', operations: 'inscripcion-078' },
  { id: '079', file: '079_solicitudes_identidad_archivo.sql', operations: 'inscripcion-079' },
  { id: '080', file: '080_identidad_tipo_numero.sql', operations: 'inscripcion-080' },
  { id: '081', file: '081_ajustes_contrato.sql', operations: 'inscripcion-081' },
  { id: '082', file: '082_solapes_alumno_todas_vias.sql', operations: 'inscripcion-082' },
  { id: '083', file: '083_espera_por_tipo_avisos_diarios.sql', operations: 'inscripcion-083' },
];
export const EXCLUDED_MIGRATIONS = ['064_precio_por_tipo_curso.sql'] as const;
export const LATEST_MIGRATION = '083';
export function approvedMigrations(through = LATEST_MIGRATION): readonly MigrationEntry[] {
  if (through === '000') return [];
  const end = MIGRATION_MANIFEST.findIndex((entry) => entry.id === through);
  if (end < 0) throw new Error(`Límite no aprobado en manifiesto: ${through}`);
  const actual = readdirSync(resolve(__dirname, '../../migrations')).filter((f) =>
    f.endsWith('.sql'),
  );
  const known = new Set<string>([
    ...MIGRATION_MANIFEST.map((entry) => entry.file),
    ...EXCLUDED_MIGRATIONS,
  ]);
  const unknown = actual.filter((file) => !known.has(file));
  const missing = MIGRATION_MANIFEST.filter((entry) => !actual.includes(entry.file));
  if (unknown.length || missing.length)
    throw new Error(
      `Manifiesto incompleto: desconocidas=${unknown.join(',')}; ausentes=${missing.map((e) => e.file).join(',')}`,
    );
  return MIGRATION_MANIFEST.slice(0, end + 1);
}
