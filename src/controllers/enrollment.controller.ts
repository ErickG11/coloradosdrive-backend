import type { Request, Response } from 'express';

import { mailer } from '../config/mailer';
import { supabaseAdmin } from '../config/supabase';
import type { CreateEnrollmentInput } from '../models/enrollment.model';
import { EmailService } from '../services/email.service';
import { EnrollmentService, type EnrollStudentResult } from '../services/enrollment.service';

const enrollmentService = new EnrollmentService(supabaseAdmin, new EmailService(mailer));

export async function createEnrollment(
  req: Request,
  res: Response<EnrollStudentResult>,
): Promise<void> {
  const result = await enrollmentService.enrollStudent(req.body as CreateEnrollmentInput);
  res.status(201).json(result);
}
