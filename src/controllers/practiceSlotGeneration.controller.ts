import type { Request, Response } from 'express';

import { supabaseAdmin } from '../config/supabase';
import type {
  ConfirmarPracticaInput,
  ConfirmarPracticaResult,
  SugerirPracticaInput,
  SugerirPracticaResult,
} from '../models/practiceSlotGeneration.model';
import { PracticeSlotGenerationService } from '../services/practiceSlotGeneration.service';

const practiceSlotGenerationService = new PracticeSlotGenerationService(supabaseAdmin);

export async function sugerirPractica(
  req: Request,
  res: Response<SugerirPracticaResult>,
): Promise<void> {
  const result = await practiceSlotGenerationService.sugerir(
    req.params.enrollmentId,
    req.body as SugerirPracticaInput,
  );
  res.status(200).json(result);
}

export async function confirmarPractica(
  req: Request,
  res: Response<ConfirmarPracticaResult>,
): Promise<void> {
  const result = await practiceSlotGenerationService.confirmar(
    req.params.enrollmentId,
    req.body as ConfirmarPracticaInput,
  );
  res.status(201).json(result);
}
