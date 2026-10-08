import { Router } from 'express';
import { body } from 'express-validator';

import { changePassword } from '../controllers/estudiante.controller';
import { supabaseAdmin } from '../config/supabase';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';

export const estudianteRouter = Router();

estudianteRouter.use(asyncHandler(authenticate), requireRole('estudiante'));

// Consulta mínima del propio sujeto; sigue requiriendo JWT y rol estudiante.
estudianteRouter.get(
  '/account-status',
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError('Authentication required', 401);
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('debe_cambiar_password')
      .eq('id', req.user.id)
      .single();
    if (error) throw error;
    res.json({ mustChangePassword: data.debe_cambiar_password });
  }),
);

estudianteRouter.get(
  '/enrollments',
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError('Authentication required', 401);
    const { data, error } = await supabaseAdmin
      .from('enrollments')
      .select('cohort_id,course_type')
      .eq('student_id', req.user.id)
      .eq('status', 'activo');
    if (error) throw error;
    res.json(data.map((e) => ({ cohortId: e.cohort_id, courseType: e.course_type })));
  }),
);

// Única ruta exenta del bloqueo de auth.middleware.ts cuando
// debe_cambiar_password=true (ver CHANGE_PASSWORD_PATH en ese archivo).
estudianteRouter.post(
  '/cambiar-password',
  [
    body('nuevaPassword')
      .isString()
      .isLength({ min: 8 })
      .withMessage('nuevaPassword debe tener al menos 8 caracteres'),
  ],
  validate,
  asyncHandler(changePassword),
);
