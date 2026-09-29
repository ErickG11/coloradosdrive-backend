import type { Request, Response } from 'express';

import { supabaseAdmin } from '../config/supabase';
import { CohortAssignmentService } from '../services/cohortAssignment.service';

const cohortAssignmentService = new CohortAssignmentService(supabaseAdmin);

interface PreviewCohortAssignmentBody {
  courseId: string;
}

interface PreviewCohortAssignmentResponse {
  cohortId: string | null;
  cohortNombre?: string | null;
  warning?: string | null;
  mensaje?: string;
}

// Fase 10: previsualiza a qué cohorte asignaría assignCohort (mismo
// service que usa la aprobación de solicitudes online) SIN crear ninguna
// inscripción — el admin decide si acepta la sugerencia o elige otra
// cohorte a mano al matricular manualmente (ver POST /enrollments).
export async function previewCohortAssignment(
  req: Request,
  res: Response<PreviewCohortAssignmentResponse>,
): Promise<void> {
  const { courseId } = req.body as PreviewCohortAssignmentBody;
  const asignacion = await cohortAssignmentService.assignCohortForCourse(courseId);

  if (asignacion.cohortId === null) {
    res.status(200).json({ cohortId: null, mensaje: 'ninguna cohorte con matrícula abierta' });
    return;
  }

  res.status(200).json({
    cohortId: asignacion.cohortId,
    cohortNombre: asignacion.cohortNombre,
    warning: asignacion.warning,
  });
}
