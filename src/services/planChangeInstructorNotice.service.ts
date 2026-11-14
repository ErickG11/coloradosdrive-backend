import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../config/database.types';
import { logSafeError } from '../utils/safeLog';

export interface FuturePractice {
  id: string;
  instructorId: string;
  scheduledAt: string;
  minutes: number;
}
const ZONE = 'America/Guayaquil';
const MAX_LINES = 8;

// Foto de las prácticas futuras del alumno en su cohorte (asignadas o confirmadas).
export async function snapshotFuturePractices(
  db: SupabaseClient<Database>,
  studentId: string,
  cohortId: string,
): Promise<FuturePractice[]> {
  const { data, error } = await db
    .from('practice_slots')
    .select('id, instructor_id, scheduled_at, duration_minutes')
    .eq('student_id', studentId)
    .eq('cohort_id', cohortId)
    .in('status', ['asignado', 'confirmado'])
    .gt('scheduled_at', new Date().toISOString());
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    instructorId: row.instructor_id,
    scheduledAt: row.scheduled_at,
    minutes: row.duration_minutes,
  }));
}

const key = (p: FuturePractice): string => `${p.instructorId}|${String(Date.parse(p.scheduledAt))}`;
const part = (parts: Intl.DateTimeFormatPart[], type: string): string =>
  parts.find((p) => p.type === type)?.value ?? '';
function dayLabel(ms: number): string {
  const parts = new Intl.DateTimeFormat('es-EC', {
    timeZone: ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).formatToParts(new Date(ms));
  return `${part(parts, 'weekday')} ${part(parts, 'day')} de ${part(parts, 'month')}`;
}
function hourLabel(ms: number): string {
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms));
}
// Une horas consecutivas en un solo tramo: «lunes 30 de noviembre, 08:00 a 10:00».
export function describeRanges(practices: FuturePractice[]): string[] {
  const sorted = practices
    .map((p) => ({ start: Date.parse(p.scheduledAt), minutes: p.minutes }))
    .sort((a, b) => a.start - b.start);
  const ranges: { start: number; end: number }[] = [];
  for (const slot of sorted) {
    const last = ranges.at(-1);
    const end = slot.start + slot.minutes * 60000;
    if (last?.end === slot.start) last.end = end;
    else ranges.push({ start: slot.start, end });
  }
  return ranges.map((r) => `${dayLabel(r.start)}, ${hourLabel(r.start)} a ${hourLabel(r.end)}`);
}
function list(lines: string[]): string {
  if (lines.length <= MAX_LINES) return lines.join('; ');
  return `${lines.slice(0, MAX_LINES).join('; ')} y ${String(lines.length - MAX_LINES)} más`;
}

// Un solo aviso de bandeja por instructor afectado, sin correo y sin duplicar en reintentos.
export async function notifyInstructorsOfPlanChange(
  db: SupabaseClient<Database>,
  input: {
    studentName: string;
    reservationId: string;
    before: FuturePractice[];
    after: FuturePractice[];
  },
): Promise<string[]> {
  const beforeKeys = new Set(input.before.map(key));
  const afterKeys = new Set(input.after.map(key));
  const removed = input.before.filter((p) => !afterKeys.has(key(p)));
  const added = input.after.filter((p) => !beforeKeys.has(key(p)));
  const instructors = [...new Set([...removed, ...added].map((p) => p.instructorId))];
  if (!instructors.length) return [];
  const { data: active, error } = await db
    .from('users')
    .select('id')
    .in('id', instructors)
    .eq('rol', 'instructor')
    .eq('activo', true);
  if (error) throw error;
  const notified: string[] = [];
  for (const row of active) {
    const taken = removed.filter((p) => p.instructorId === row.id);
    const given = added.filter((p) => p.instructorId === row.id);
    const sentences = [`Se cambió el horario de ${input.studentName}.`];
    if (taken.length) sentences.push(`Se te quitan: ${list(describeRanges(taken))}.`);
    if (given.length) sentences.push(`Se te asignan: ${list(describeRanges(given))}.`);
    const insert = await db.from('notifications').insert({
      user_id: row.id,
      tipo: 'cambio_agenda_instructor',
      titulo: 'Cambio de horario de un alumno',
      mensaje: sentences.join(' '),
      domain_code: 'PLAN_CAMBIO_INSTRUCTOR',
      domain_entity_id: input.reservationId,
      email_status: null,
    });
    // 23505: el reintento ya había creado este aviso.
    if (insert.error && insert.error.code !== '23505') throw insert.error;
    if (!insert.error) notified.push(row.id);
  }
  return notified;
}

export async function safeNotify(
  db: SupabaseClient<Database>,
  input: Parameters<typeof notifyInstructorsOfPlanChange>[1],
): Promise<{ ok: boolean; notified: string[] }> {
  try {
    return { ok: true, notified: await notifyInstructorsOfPlanChange(db, input) };
  } catch (error) {
    logSafeError('plan_change_instructor_notice_failed', error);
    return { ok: false, notified: [] };
  }
}

// Las horas que el cambio de plan dejó de usar nunca se cancelaron: la función SQL las deja
// «liberado» y aquí vuelven a «disponible». Una sola sentencia con el filtro completo; las
// franjas reutilizadas por el plan nuevo (foto posterior) no se tocan.
export async function releaseUnusedSlots(
  db: SupabaseClient<Database>,
  before: FuturePractice[],
  after: FuturePractice[],
): Promise<number> {
  const kept = new Set(after.map((p) => p.id));
  const ids = before.filter((p) => !kept.has(p.id)).map((p) => p.id);
  if (!ids.length) return 0;
  const { data, error } = await db
    .from('practice_slots')
    .update({ status: 'disponible' })
    .in('id', ids)
    .is('student_id', null)
    .eq('status', 'liberado')
    .gt('scheduled_at', new Date().toISOString())
    .select('id');
  if (error) throw error;
  return data.length;
}

export async function safeReleaseUnusedSlots(
  db: SupabaseClient<Database>,
  before: FuturePractice[],
  after: FuturePractice[],
): Promise<void> {
  try {
    await releaseUnusedSlots(db, before, after);
  } catch (error) {
    logSafeError('plan_change_release_slots_failed', error);
  }
}
