import type { Request, Response } from 'express';

import { supabaseAdmin } from '../config/supabase';
import { mailer } from '../config/mailer';
import type { CancelPracticeSlotInput, CancelPracticeSlotResult, CancellationPreview, PracticeSlot, SubmitAttendanceInput } from '../models/practiceSlot.model';
import { EmailService } from '../services/email.service';
import { PracticeSlotActionService } from '../services/practiceSlotAction.service';
import { RealtimeService } from '../services/realtime.service';
import { AppError } from '../utils/AppError';

const practiceSlotActionService = new PracticeSlotActionService(
  supabaseAdmin,
  new RealtimeService(supabaseAdmin),
  new EmailService(mailer),
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

export async function previewPracticeSlotCancellation(req: Request, res: Response<CancellationPreview>): Promise<void> {
  res.status(200).json(await practiceSlotActionService.previewCancellation(req.params.id, requireStudentId(req)));
}

export async function cancelPracticeSlot(req: Request, res: Response<CancelPracticeSlotResult>): Promise<void> {
  const studentId = requireStudentId(req);
  const slot = await practiceSlotActionService.cancelSlot(req.params.id, studentId, req.body as CancelPracticeSlotInput);
  res.status(200).json(slot);
}

export async function markPracticeSlotAttendance(
  req: Request,
  res: Response<PracticeSlot>,
): Promise<void> {
  if (!req.user) {
    throw new AppError('Authentication required', 401);
  }
  const { attended } = req.body as SubmitAttendanceInput;
  const slot = await practiceSlotActionService.markAttendance(req.params.id, req.user.id, attended);
  res.status(200).json(slot);
}
