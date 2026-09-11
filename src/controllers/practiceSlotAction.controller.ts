import type { Request, Response } from 'express';

import { supabaseAdmin } from '../config/supabase';
import type { PracticeSlot } from '../models/practiceSlot.model';
import { PracticeSlotActionService } from '../services/practiceSlotAction.service';
import { RealtimeService } from '../services/realtime.service';
import { AppError } from '../utils/AppError';

const practiceSlotActionService = new PracticeSlotActionService(
  supabaseAdmin,
  new RealtimeService(supabaseAdmin),
);

function requireStudentId(req: Request): string {
  if (!req.user) {
    throw new AppError('Authentication required', 401);
  }
  return req.user.id;
}

export async function claimPracticeSlot(req: Request, res: Response<PracticeSlot>): Promise<void> {
  const studentId = requireStudentId(req);
  const slot = await practiceSlotActionService.claimSlot(req.params.id, studentId);
  res.status(200).json(slot);
}

export async function confirmPracticeSlot(
  req: Request,
  res: Response<PracticeSlot>,
): Promise<void> {
  const studentId = requireStudentId(req);
  const slot = await practiceSlotActionService.confirmSlot(req.params.id, studentId);
  res.status(200).json(slot);
}

export async function cancelPracticeSlot(req: Request, res: Response<PracticeSlot>): Promise<void> {
  const studentId = requireStudentId(req);
  const slot = await practiceSlotActionService.cancelSlot(req.params.id, studentId);
  res.status(200).json(slot);
}
