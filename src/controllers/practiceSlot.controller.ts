import type { Request, Response } from 'express';

import { supabaseAdmin } from '../config/supabase';
import type {
  CreatePracticeSlotInput,
  PracticeSlot,
  PracticeSlotStatus,
  PracticeSlotWithNames,
  UpdatePracticeSlotInput,
} from '../models/practiceSlot.model';
import { PracticeSlotService } from '../services/practiceSlot.service';
import { AppError } from '../utils/AppError';

const practiceSlotService = new PracticeSlotService(supabaseAdmin);

export async function createPracticeSlot(req: Request, res: Response<PracticeSlot>): Promise<void> {
  const slot = await practiceSlotService.createSlot(req.body as CreatePracticeSlotInput);
  res.status(201).json(slot);
}

// admin ve todas las franjas (filtrables por cohortId/instructorId/
// status); estudiante ve las disponibles de su cohorte + las propias;
// instructor ve todas las suyas (cualquier estado).
export async function listPracticeSlots(
  req: Request,
  res: Response<PracticeSlotWithNames[]>,
): Promise<void> {
  if (!req.user) {
    throw new AppError('Authentication required', 401);
  }

  if (req.user.role === 'admin') {
    const { cohortId, instructorId, status } = req.query;
    const slots = await practiceSlotService.listSlotsForAdmin({
      cohortId: typeof cohortId === 'string' ? cohortId : undefined,
      instructorId: typeof instructorId === 'string' ? instructorId : undefined,
      status: typeof status === 'string' ? (status as PracticeSlotStatus) : undefined,
    });
    res.status(200).json(slots);
    return;
  }

  if (req.user.role === 'instructor') {
    const slots = await practiceSlotService.listSlotsForInstructor(req.user.id);
    res.status(200).json(slots);
    return;
  }

  const slots = await practiceSlotService.listSlotsForStudent(req.user.id);
  res.status(200).json(slots);
}

export async function updatePracticeSlot(req: Request, res: Response<PracticeSlot>): Promise<void> {
  const slot = await practiceSlotService.updateSlot(
    req.params.id,
    req.body as UpdatePracticeSlotInput,
  );
  res.status(200).json(slot);
}

export async function deletePracticeSlot(req: Request, res: Response): Promise<void> {
  await practiceSlotService.deleteSlot(req.params.id);
  res.status(204).send();
}
