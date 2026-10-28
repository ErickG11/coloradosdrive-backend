import type { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { PracticeRatingService } from '../services/practiceRating.service';
import { AppError } from '../utils/AppError';

const service = new PracticeRatingService(supabaseAdmin);
const actor = (req: Request): string => {
  if (!req.user) throw new AppError('Authentication required', 401);
  return req.user.id;
};
const pagination = (req: Request): { page: number; pageSize: number } => ({
  page: Number(req.query.page ?? 1),
  pageSize: Number(req.query.pageSize ?? 20),
});

export async function pendingPracticeRatings(req: Request, res: Response): Promise<void> {
  const { page, pageSize } = pagination(req);
  res.json(await service.pending(actor(req), page, pageSize));
}

export async function submitPracticeRating(req: Request, res: Response): Promise<void> {
  const body = req.body as { practiceSlotId: string; score: number; comment?: string };
  const result = await service.submit(
    actor(req),
    body.practiceSlotId,
    body.score,
    body.comment ?? null,
  );
  res.status(201).json(result);
}

export async function listInstructorRatings(req: Request, res: Response): Promise<void> {
  const { page, pageSize } = pagination(req);
  res.json(await service.ranking(actor(req), page, pageSize));
}

export async function instructorRatingDetail(req: Request, res: Response): Promise<void> {
  const { page, pageSize } = pagination(req);
  res.json(await service.detail(actor(req), req.params.instructorId, page, pageSize));
}
