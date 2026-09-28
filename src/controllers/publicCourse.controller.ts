import type { Request, Response } from 'express';

import { supabaseAdmin } from '../config/supabase';
import type { PublicCourse } from '../models/publicCourse.model';
import { PublicCourseService } from '../services/publicCourse.service';

const publicCourseService = new PublicCourseService(supabaseAdmin);

export async function listPublicCourses(
  _req: Request,
  res: Response<PublicCourse[]>,
): Promise<void> {
  const courses = await publicCourseService.listPublicCourses();
  res.status(200).json(courses);
}
