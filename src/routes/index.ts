import { Router } from 'express';

import { cohortAssignmentRouter } from './cohortAssignment.routes';
import { cohortRouter } from './cohort.routes';
import { courseRouter } from './course.routes';
import { enrollmentRouter } from './enrollment.routes';
import { estudianteRouter } from './estudiante.routes';
import { attemptRouter } from './examAttempt.routes';
import { examRouter, questionRouter } from './exam.routes';
import { healthRouter } from './health.routes';
import { practiceSlotRouter } from './practiceSlot.routes';
import { practiceSlotGenerationRouter } from './practiceSlotGeneration.routes';
import { publicCourseRouter } from './publicCourse.routes';
import { solicitudAdminRouter, solicitudRouter } from './solicitud.routes';
import { userRouter } from './user.routes';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/courses', courseRouter);
apiRouter.use('/public/courses', publicCourseRouter);
apiRouter.use('/cohorts', cohortRouter);
apiRouter.use('/enrollments', enrollmentRouter);
apiRouter.use('/estudiantes', estudianteRouter);
apiRouter.use('/exams', examRouter);
apiRouter.use('/questions', questionRouter);
apiRouter.use('/attempts', attemptRouter);
apiRouter.use('/practice-slots', practiceSlotRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/solicitudes', solicitudRouter);
apiRouter.use('/admin/solicitudes', solicitudAdminRouter);
apiRouter.use('/admin/enrollments', practiceSlotGenerationRouter);
apiRouter.use('/admin/cohort-assignment', cohortAssignmentRouter);
