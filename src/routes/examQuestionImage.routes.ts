import { Router } from 'express';
import type { RequestHandler, Request } from 'express';
import { body, matchedData, param } from 'express-validator';
import multer from 'multer';
import { supabaseAdmin } from '../config/supabase';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate';
import { ExamService } from '../services/exam.service';
import { contentError } from '../services/content.service';
import { ExamQuestionImageService } from '../services/examQuestionImage.service';
import {
  QUESTION_IMAGE_MAX_BYTES,
  questionImageError,
} from '../services/questionImageStorage.service';
import { asyncHandler } from '../utils/asyncHandler';

export const examQuestionImageRouter = Router();
const images = new ExamQuestionImageService(supabaseAdmin);
const exams = new ExamService(supabaseAdmin);
function actor(req: Request): string {
  if (!req.user) throw contentError('ACCESS_DENIED', 401);
  return req.user.id;
}
examQuestionImageRouter.use(asyncHandler(authenticate), requireRole('admin'));
const ids = (): ReturnType<typeof param>[] => [
  param('examId').isUUID().withMessage('examId debe ser un UUID válido'),
  param('questionId').isUUID().withMessage('questionId debe ser un UUID válido'),
];
const path = '/:examId/questions/:questionId/image';
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: QUESTION_IMAGE_MAX_BYTES, files: 1, fields: 1, fieldSize: 1200, parts: 2 },
});
const parseImage: RequestHandler = (req, res, next) => {
  upload.single('image')(req, res, (error: unknown) => {
    next(
      error
        ? questionImageError(
            error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
              ? 'IMAGE_TOO_LARGE'
              : 'IMAGE_UPLOAD_INVALID',
            error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
          )
        : undefined,
    );
  });
};
examQuestionImageRouter.post(
  path,
  ids(),
  validate,
  parseImage,
  body('alt')
    .optional()
    .isString()
    .withMessage('alt debe ser texto')
    .isLength({ max: 300 })
    .withMessage('alt debe tener como máximo 300 caracteres'),
  validate,
  asyncHandler(async (req, res) => {
    if (!req.file) throw questionImageError('IMAGE_REQUIRED');
    const fields = matchedData<{ alt?: string }>(req);
    await images.upload(actor(req), req.params.examId, req.params.questionId, req.file, fields.alt);
    res
      .set('Cache-Control', 'no-store')
      .status(201)
      .json(await exams.getQuestionById(req.params.questionId));
  }),
);
examQuestionImageRouter.patch(
  path,
  ids(),
  body('alt')
    .exists({ checkNull: false })
    .withMessage('alt es obligatorio; envía null para vaciarlo')
    .bail()
    .custom(
      (value: unknown) =>
        value === null || (typeof value === 'string' && Array.from(value).length <= 300),
    )
    .withMessage('alt debe ser texto de hasta 300 caracteres o null'),
  validate,
  asyncHandler(async (req, res) => {
    await images.updateAlt(
      actor(req),
      req.params.examId,
      req.params.questionId,
      matchedData<{ alt: string | null }>(req).alt,
    );
    res.set('Cache-Control', 'no-store').json(await exams.getQuestionById(req.params.questionId));
  }),
);
examQuestionImageRouter.delete(
  path,
  ids(),
  validate,
  asyncHandler(async (req, res) => {
    await images.remove(actor(req), req.params.examId, req.params.questionId);
    res.status(204).send();
  }),
);
