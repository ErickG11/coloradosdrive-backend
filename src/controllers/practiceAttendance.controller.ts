import type { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { PracticeAttendanceService } from '../services/practiceAttendance.service';
import { AppError } from '../utils/AppError';

const service = new PracticeAttendanceService(supabaseAdmin);
function actor(req: Request): string {
  if (!req.user) throw new AppError('Authentication required', 401);
  return req.user.id;
}
export async function attendanceEvents(req: Request, res: Response): Promise<void> {
  res.json(
    await service.events(
      actor(req),
      req.params.id,
      Number(req.query.page ?? 1),
      Number(req.query.pageSize ?? 20),
    ),
  );
}
export async function studentPracticeHistory(req: Request, res: Response): Promise<void> {
  res.json(
    await service.history(
      actor(req),
      req.query.enrollmentId as string,
      Number(req.query.page ?? 1),
      Number(req.query.pageSize ?? 20),
    ),
  );
}
export async function studentPracticeEnrollments(req: Request, res: Response): Promise<void> {
  res.json(await service.enrollments(actor(req)));
}
