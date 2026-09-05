import { Router } from 'express';

import { cohortRouter } from './cohort.routes';
import { courseRouter } from './course.routes';
import { enrollmentRouter } from './enrollment.routes';
import { examRouter, questionRouter } from './exam.routes';
import { healthRouter } from './health.routes';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/courses', courseRouter);
apiRouter.use('/cohorts', cohortRouter);
apiRouter.use('/enrollments', enrollmentRouter);
apiRouter.use('/exams', examRouter);
apiRouter.use('/questions', questionRouter);
