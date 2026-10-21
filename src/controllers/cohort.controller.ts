import type { Request, Response } from 'express';

import { supabaseAdmin } from '../config/supabase';
import type {
  Cohort,
  CohortDeletionResult,
  CohortDetail,
  CreateCohortInput,
  UpdateCohortInput,
} from '../models/cohort.model';
import { CohortService } from '../services/cohort.service';

const cohortService = new CohortService(supabaseAdmin);

export async function createCohort(req: Request, res: Response<Cohort>): Promise<void> {
  const cohort = await cohortService.createCohort(req.body as CreateCohortInput);
  res.status(201).json(cohort);
}

export async function listCohorts(_req: Request, res: Response<Cohort[]>): Promise<void> {
  const cohorts = await cohortService.listCohorts();
  res.status(200).json(cohorts);
}

export async function getCohort(req: Request, res: Response<CohortDetail>): Promise<void> {
  const cohort = await cohortService.getCohort(req.params.id);
  res.status(200).json(cohort);
}

export async function updateCohort(req: Request, res: Response<Cohort>): Promise<void> {
  const cohort = await cohortService.updateCohort(req.params.id, req.body as UpdateCohortInput);
  res.status(200).json(cohort);
}

export async function deleteCohort(
  req: Request,
  res: Response<CohortDeletionResult>,
): Promise<void> {
  const { confirmacionNombre } = req.body as { confirmacionNombre: string };
  res.status(200).json(await cohortService.deleteCohort(req.params.id, confirmacionNombre));
}
