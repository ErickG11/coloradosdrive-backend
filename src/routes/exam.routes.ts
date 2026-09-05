import { Router } from 'express';
import { body, param, query } from 'express-validator';

import {
  addQuestion,
  createExam,
  deleteExam,
  deleteQuestion,
  getExamById,
  listExams,
  updateExam,
  updateQuestion,
} from '../controllers/exam.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/asyncHandler';

export const examRouter = Router();
export const questionRouter = Router();

examRouter.use(asyncHandler(authenticate));
questionRouter.use(asyncHandler(authenticate));

// RF-02: estructura de una pregunta anidada dentro de un examen. Se valida
// aqui (no solo con el CHECK de la migracion 004) para devolver un 400 con
// mensaje claro en vez de un error de base de datos.
function validateQuestionShape(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    throw new Error('cada pregunta debe ser un objeto');
  }
  const question = value as Record<string, unknown>;

  if (question.type !== 'opcion_multiple' && question.type !== 'texto_abierto') {
    throw new Error('type de pregunta debe ser opcion_multiple o texto_abierto');
  }
  if (typeof question.prompt !== 'string' || question.prompt.trim() === '') {
    throw new Error('prompt de pregunta es obligatorio');
  }
  if (typeof question.orderIndex !== 'number' || !Number.isInteger(question.orderIndex)) {
    throw new Error('orderIndex de pregunta debe ser un entero');
  }
  if (typeof question.points !== 'number' || question.points <= 0) {
    throw new Error('points de pregunta debe ser un número mayor a 0');
  }

  if (question.type === 'texto_abierto') {
    if (
      typeof question.correctAnswerText !== 'string' ||
      question.correctAnswerText.trim() === ''
    ) {
      throw new Error('correctAnswerText es obligatorio para preguntas de texto_abierto');
    }
    if (
      question.synonyms !== undefined &&
      (!Array.isArray(question.synonyms) ||
        !question.synonyms.every((s) => typeof s === 'string' && s.trim() !== ''))
    ) {
      throw new Error('synonyms debe ser un arreglo de strings no vacíos');
    }
    return true;
  }

  if (!Array.isArray(question.options) || question.options.length < 2) {
    throw new Error('preguntas de opcion_multiple necesitan al menos 2 opciones');
  }

  const orderIndexes = new Set<number>();
  let correctCount = 0;
  for (const rawOption of question.options as unknown[]) {
    if (typeof rawOption !== 'object' || rawOption === null) {
      throw new Error('cada opción debe ser un objeto');
    }
    const option = rawOption as Record<string, unknown>;

    if (typeof option.optionText !== 'string' || option.optionText.trim() === '') {
      throw new Error('optionText es obligatorio en cada opción');
    }
    if (typeof option.isCorrect !== 'boolean') {
      throw new Error('isCorrect debe ser boolean en cada opción');
    }
    if (typeof option.orderIndex !== 'number' || !Number.isInteger(option.orderIndex)) {
      throw new Error('orderIndex de opción debe ser un entero');
    }
    if (orderIndexes.has(option.orderIndex)) {
      throw new Error('orderIndex de opción debe ser único dentro de la pregunta');
    }
    orderIndexes.add(option.orderIndex);
    if (option.isCorrect) {
      correctCount += 1;
    }
  }
  if (correctCount !== 1) {
    throw new Error('cada pregunta de opcion_multiple debe tener exactamente una opción correcta');
  }

  return true;
}

function validateQuestionsArray(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('questions debe ser un arreglo no vacío');
  }

  const orderIndexes = new Set<number>();
  for (const question of value as unknown[]) {
    validateQuestionShape(question);
    const orderIndex = (question as { orderIndex: number }).orderIndex;
    if (orderIndexes.has(orderIndex)) {
      throw new Error('orderIndex de pregunta debe ser único dentro del examen');
    }
    orderIndexes.add(orderIndex);
  }

  return true;
}

const createExamValidators = [
  body('courseId').isUUID().withMessage('courseId debe ser un UUID válido'),
  body('title').isString().trim().notEmpty().withMessage('title es obligatorio'),
  body('type').isIn(['practica', 'definitivo']).withMessage('type debe ser practica o definitivo'),
  body('timeLimitMinutes')
    .isInt({ min: 1 })
    .withMessage('timeLimitMinutes debe ser un entero mayor a 0'),
  body('passingScorePercent')
    .isFloat({ min: 0, max: 100 })
    .withMessage('passingScorePercent debe estar entre 0 y 100'),
  body('questions').custom(validateQuestionsArray),
];

const listExamsValidators = [
  query('courseId').optional().isUUID().withMessage('courseId debe ser un UUID válido'),
];

const idParamValidator = param('id').isUUID().withMessage('id debe ser un UUID válido');

const updateExamValidators = [
  idParamValidator,
  body('title').optional().isString().trim().notEmpty().withMessage('title no puede estar vacío'),
  body('timeLimitMinutes')
    .optional()
    .isInt({ min: 1 })
    .withMessage('timeLimitMinutes debe ser un entero mayor a 0'),
  body('passingScorePercent')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('passingScorePercent debe estar entre 0 y 100'),
  body('isPublished').optional().isBoolean().withMessage('isPublished debe ser boolean'),
];

const addQuestionValidators = [idParamValidator, body().custom(validateQuestionShape)];

const updateQuestionValidators = [
  idParamValidator,
  body('prompt').optional().isString().trim().notEmpty().withMessage('prompt no puede estar vacío'),
  body('orderIndex').optional().isInt().withMessage('orderIndex debe ser un entero'),
  body('points').optional().isFloat({ min: 0.01 }).withMessage('points debe ser mayor a 0'),
  body('correctAnswerText')
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage('correctAnswerText no puede estar vacío'),
  body('synonyms')
    .optional()
    .isArray()
    .withMessage('synonyms debe ser un arreglo de strings')
    .custom((value: unknown[]): boolean => {
      if (!value.every((s) => typeof s === 'string' && s.trim() !== '')) {
        throw new Error('synonyms debe ser un arreglo de strings no vacíos');
      }
      return true;
    }),
  body('options')
    .optional()
    .isArray({ min: 2 })
    .withMessage('options debe tener al menos 2 elementos')
    .custom((options: unknown[]) => {
      const orderIndexes = new Set<number>();
      let correctCount = 0;
      for (const rawOption of options) {
        if (typeof rawOption !== 'object' || rawOption === null) {
          throw new Error('cada opción debe ser un objeto');
        }
        const option = rawOption as Record<string, unknown>;
        if (typeof option.optionText !== 'string' || option.optionText.trim() === '') {
          throw new Error('optionText es obligatorio en cada opción');
        }
        if (typeof option.isCorrect !== 'boolean') {
          throw new Error('isCorrect debe ser boolean en cada opción');
        }
        if (typeof option.orderIndex !== 'number' || !Number.isInteger(option.orderIndex)) {
          throw new Error('orderIndex de opción debe ser un entero');
        }
        if (orderIndexes.has(option.orderIndex)) {
          throw new Error('orderIndex de opción debe ser único dentro de la pregunta');
        }
        orderIndexes.add(option.orderIndex);
        if (option.isCorrect) {
          correctCount += 1;
        }
      }
      if (correctCount !== 1) {
        throw new Error(
          'cada pregunta de opcion_multiple debe tener exactamente una opción correcta',
        );
      }
      return true;
    }),
];

// RF-02: el administrador gestiona examenes y preguntas; el estudiante solo
// puede listar (GET /) los examenes publicados de su propio curso.
examRouter.post(
  '/',
  requireRole('admin'),
  createExamValidators,
  validate,
  asyncHandler(createExam),
);
examRouter.get(
  '/',
  requireRole('admin', 'estudiante'),
  listExamsValidators,
  validate,
  asyncHandler(listExams),
);
examRouter.get('/:id', requireRole('admin'), idParamValidator, validate, asyncHandler(getExamById));
examRouter.patch(
  '/:id',
  requireRole('admin'),
  updateExamValidators,
  validate,
  asyncHandler(updateExam),
);
examRouter.delete(
  '/:id',
  requireRole('admin'),
  idParamValidator,
  validate,
  asyncHandler(deleteExam),
);
examRouter.post(
  '/:id/questions',
  requireRole('admin'),
  addQuestionValidators,
  validate,
  asyncHandler(addQuestion),
);

questionRouter.patch(
  '/:id',
  requireRole('admin'),
  updateQuestionValidators,
  validate,
  asyncHandler(updateQuestion),
);
questionRouter.delete(
  '/:id',
  requireRole('admin'),
  idParamValidator,
  validate,
  asyncHandler(deleteQuestion),
);
