import type { Request, Response } from 'express';

import { supabaseAdmin } from '../config/supabase';
import type {
  CreateExamInput,
  CreateQuestionInput,
  Exam,
  ExamWithQuestions,
  Question,
  UpdateExamInput,
  UpdateQuestionInput,
} from '../models/exam.model';
import { ExamService } from '../services/exam.service';
import { AppError } from '../utils/AppError';

const examService = new ExamService(supabaseAdmin);

export async function createExam(req: Request, res: Response<ExamWithQuestions>): Promise<void> {
  const exam = await examService.createExam(req.body as CreateExamInput);
  res.status(201).json(exam);
}

// admin ve todos los examenes (opcionalmente filtrados por courseId);
// estudiante ve solo los publicados del curso de su inscripcion activa.
export async function listExams(req: Request, res: Response<Exam[]>): Promise<void> {
  if (!req.user) {
    throw new AppError('Authentication required', 401);
  }

  const courseId = typeof req.query.courseId === 'string' ? req.query.courseId : undefined;
  const exams =
    req.user.role === 'admin'
      ? await examService.listExamsForAdmin(courseId)
      : await examService.listExamsForStudent(req.user.id);

  res.status(200).json(exams);
}

// Detalle completo (incluye respuestas correctas): solo admin, ver
// requireRole('admin') en exam.routes.ts.
export async function getExamById(req: Request, res: Response<ExamWithQuestions>): Promise<void> {
  const exam = await examService.getExamById(req.params.id);
  res.status(200).json(exam);
}

export async function updateExam(req: Request, res: Response<Exam>): Promise<void> {
  const exam = await examService.updateExam(req.params.id, req.body as UpdateExamInput);
  res.status(200).json(exam);
}

export async function deleteExam(req: Request, res: Response): Promise<void> {
  await examService.deleteExam(req.params.id);
  res.status(204).send();
}

export async function addQuestion(req: Request, res: Response<Question>): Promise<void> {
  const question = await examService.addQuestion(req.params.id, req.body as CreateQuestionInput);
  res.status(201).json(question);
}

export async function updateQuestion(req: Request, res: Response<Question>): Promise<void> {
  const question = await examService.updateQuestion(req.params.id, req.body as UpdateQuestionInput);
  res.status(200).json(question);
}

export async function deleteQuestion(req: Request, res: Response): Promise<void> {
  await examService.deleteQuestion(req.params.id);
  res.status(204).send();
}
