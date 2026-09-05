import type { Request, Response } from 'express';

import { mailer } from '../config/mailer';
import { supabaseAdmin } from '../config/supabase';
import type {
  AttemptResult,
  StartAttemptResult,
  SubmitAttemptInput,
} from '../models/examAttempt.model';
import { EmailService } from '../services/email.service';
import { ExamAttemptService } from '../services/examAttempt.service';
import { AppError } from '../utils/AppError';

const examAttemptService = new ExamAttemptService(supabaseAdmin, new EmailService(mailer));

function requireStudentId(req: Request): string {
  if (!req.user) {
    throw new AppError('Authentication required', 401);
  }
  return req.user.id;
}

export async function startAttempt(req: Request, res: Response<StartAttemptResult>): Promise<void> {
  const studentId = requireStudentId(req);
  const result = await examAttemptService.startAttempt(req.params.id, studentId);
  res.status(201).json(result);
}

export async function submitAttempt(req: Request, res: Response<AttemptResult>): Promise<void> {
  const studentId = requireStudentId(req);
  const result = await examAttemptService.submitAttempt(
    req.params.id,
    studentId,
    req.body as SubmitAttemptInput,
  );
  res.status(200).json(result);
}
