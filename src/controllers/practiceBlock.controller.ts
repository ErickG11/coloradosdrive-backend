import type { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { RealtimeService } from '../services/realtime.service';
import { throwPracticeWriteError } from '../utils/practiceSlotIntegrity';
import { AppError } from '../utils/AppError';
import { logSafeError } from '../utils/safeLog';
import type { PracticeBlockMutation, PracticeBlockResolution } from '../models/practiceBlock.model';
const realtime = new RealtimeService(supabaseAdmin);
const student = (req: Request): string => {
  if (!req.user) throw new AppError('La sesión venció. Vuelve a iniciar sesión.', 401);
  return req.user.id;
};
async function invalidate(result: PracticeBlockMutation | PracticeBlockResolution): Promise<void> {
  const recipients = [...new Set(result.audience ?? [])];
  const jobs = recipients.flatMap((id) => [
    realtime.broadcast(`user-${id}-practice-slots`, 'notifications-updated', {}),
    realtime.broadcast(`user-${id}-notifications`, 'notifications-updated', {}),
  ]);
  if (result.cohortId)
    jobs.push(realtime.broadcast(`cohort-${result.cohortId}-practice-slots`, 'blocks-updated', {}));
  const results = await Promise.allSettled(jobs);
  for (const r of results)
    if (r.status === 'rejected') logSafeError('practice_block_realtime_failed', r.reason);
}
export async function blockSummary(req: Request, res: Response): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc('student_practice_block_summary_v14', {
    p_student: student(req),
  });
  if (error) throwPracticeWriteError(error);
  res.json(data);
}
export async function blockOptions(req: Request, res: Response): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc('student_practice_block_options_v14', {
    p_student: student(req),
  });
  if (error) throwPracticeWriteError(error);
  res.json(data);
}
export async function blockPreview(req: Request, res: Response): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc('preview_practice_block_cancellation_v14', {
    p_student: student(req),
    p_enrollment: req.params.enrollmentId,
    p_date: req.params.date,
  });
  if (error) throwPracticeWriteError(error);
  res.json(data);
}
export async function cancelBlock(req: Request, res: Response): Promise<void> {
  const body = req.body as { motivoCategoria: string; motivoTexto: string };
  const { data, error } = await supabaseAdmin.rpc('cancel_practice_block_with_reason_v14', {
    p_student: student(req),
    p_enrollment: req.params.enrollmentId,
    p_date: req.params.date,
    p_category: body.motivoCategoria,
    p_reason: body.motivoTexto,
  });
  if (error) throwPracticeWriteError(error);
  await invalidate(data);
  const { audience: _audience, ...response } = data;
  res.json(response);
}
export async function confirmBlock(req: Request, res: Response): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc('confirm_practice_block_v14', {
    p_student: student(req),
    p_enrollment: req.params.enrollmentId,
    p_date: req.params.date,
  });
  if (error) throwPracticeWriteError(error);
  await realtime
    .broadcast(`user-${student(req)}-practice-slots`, 'blocks-updated', {})
    .catch((e) => {
      logSafeError('practice_block_realtime_failed', e);
    });
  res.json(data);
}
export async function takeBlock(req: Request, res: Response): Promise<void> {
  const body = req.body as { optionId: string };
  const { data, error } = await supabaseAdmin.rpc('take_practice_block_v14', {
    p_student: student(req),
    p_enrollment: req.params.enrollmentId,
    p_option: body.optionId,
  });
  if (error) throwPracticeWriteError(error);
  await invalidate(data);
  const { audience: _audience, ...response } = data;
  res.json(response);
}
export async function practiceAbsences(req: Request, res: Response): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc('admin_practice_absences_v14', {
    p_actor: student(req),
    p_student: typeof req.query.studentId === 'string' ? req.query.studentId : null,
  });
  if (error) throwPracticeWriteError(error);
  res.json(data);
}

export async function instructorBlocks(req: Request, res: Response): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc('instructor_practice_blocks_v14', {
    p_actor: student(req),
    p_from: String(req.query.from),
    p_to: String(req.query.to),
  });
  if (error) throwPracticeWriteError(error);
  res.json(data);
}

export async function blockResolutionPreview(req: Request, res: Response): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc('preview_practice_block_resolution_v17', {
    p_student: student(req),
    p_enrollment: req.params.enrollmentId,
    p_date: req.params.date,
  });
  if (error) throwPracticeWriteError(error);
  res.json(data);
}
export async function resolveBlock(req: Request, res: Response): Promise<void> {
  const body = req.body as {
    accion: 'mover' | 'falta';
    inicio?: string;
    motivoCategoria: string;
    motivoTexto: string;
  };
  const { data, error } = await supabaseAdmin.rpc('resolve_practice_block_v17', {
    p_student: student(req),
    p_enrollment: req.params.enrollmentId,
    p_date: req.params.date,
    p_action: body.accion,
    p_start: body.accion === 'mover' ? (body.inicio ?? null) : null,
    p_category: body.motivoCategoria,
    p_reason: body.motivoTexto,
  });
  if (error) throwPracticeWriteError(error);
  await invalidate(data);
  const { audience: _audience, ...response } = data;
  res.json(response);
}
