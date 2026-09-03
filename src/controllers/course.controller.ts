import type { Request, Response } from 'express';

import { supabaseAdmin } from '../config/supabase';
import type { Course } from '../models/course.model';
import { CourseService } from '../services/course.service';

const courseService = new CourseService(supabaseAdmin);

export async function listCourses(_req: Request, res: Response<Course[]>): Promise<void> {
  const courses = await courseService.listCourses();
  res.status(200).json(courses);
}
