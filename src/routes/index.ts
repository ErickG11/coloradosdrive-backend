import { adminPaymentRouter } from './adminPayment.routes';
import { examQuestionImageRouter } from './examQuestionImage.routes';
import { contentAdminRouter, contentStudentRouter } from './content.routes';
import { kushkiWebhookRouter } from './kushkiWebhook.routes';
import { Router } from 'express';
import {
  publicEnrollmentConfigRouter,
  adminEnrollmentConfigRouter,
} from './enrollmentConfig.routes';
import { adminDashboardRouter } from './adminDashboard.routes';

import { cohortAssignmentRouter } from './cohortAssignment.routes';
import { cohortRouter } from './cohort.routes';
import { courseRouter } from './course.routes';
import { enrollmentRouter } from './enrollment.routes';
import { manualEnrollmentRouter } from './manualEnrollment.routes';
import { estudianteRouter } from './estudiante.routes';
import { attemptRouter } from './examAttempt.routes';
import { examRouter, questionRouter } from './exam.routes';
import { healthRouter } from './health.routes';
import { instructorAdminRouter, instructorSelfRouter } from './instructor.routes';
import { practiceSlotRouter } from './practiceSlot.routes';
import { practiceSlotGenerationRouter } from './practiceSlotGeneration.routes';
import { publicCourseRouter } from './publicCourse.routes';
import { privacyRouter, solicitudAdminRouter, solicitudRouter } from './solicitud.routes';
import { userRouter } from './user.routes';
import { studentAdminRouter } from './studentAdmin.routes';
import { notificationRouter } from './notification.routes';
import { instructorRatingRouter } from './instructorRating.routes';

import { adminMfaGuard } from '../middlewares/adminMfa.middleware';

export const apiRouter = Router();
// B2 · F21: debe ir antes de cualquier router /admin/*; no hace nada con ADMIN_MFA_REQUIRED=false.
apiRouter.use('/admin', adminMfaGuard());
apiRouter.use('/admin/exams', examQuestionImageRouter);
apiRouter.use('/admin/content', contentAdminRouter);
apiRouter.use('/estudiantes/content', contentStudentRouter);
apiRouter.use('/admin/pagos', adminPaymentRouter);
apiRouter.use('/webhooks/kushki', kushkiWebhookRouter);
apiRouter.use('/public/inscripcion', publicEnrollmentConfigRouter);
apiRouter.use('/admin/inscripciones', adminEnrollmentConfigRouter);
apiRouter.use('/notifications', notificationRouter);
apiRouter.use('/admin/instructor-ratings', instructorRatingRouter);
apiRouter.use('/admin/dashboard', adminDashboardRouter);

apiRouter.use('/health', healthRouter);
apiRouter.use('/courses', courseRouter);
apiRouter.use('/public/courses', publicCourseRouter);
apiRouter.use('/cohorts', cohortRouter);
apiRouter.use('/enrollments', enrollmentRouter);
apiRouter.use('/admin/manual-enrollments', manualEnrollmentRouter);
apiRouter.use('/estudiantes', estudianteRouter);
apiRouter.use('/exams', examRouter);
apiRouter.use('/questions', questionRouter);
apiRouter.use('/attempts', attemptRouter);
apiRouter.use('/practice-slots', practiceSlotRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/admin/estudiantes', studentAdminRouter);
apiRouter.use('/admin/instructores', instructorAdminRouter);
apiRouter.use('/instructores', instructorSelfRouter);
apiRouter.use('/public', privacyRouter);
apiRouter.use('/solicitudes', solicitudRouter);
apiRouter.use('/admin/solicitudes', solicitudAdminRouter);
apiRouter.use('/admin/enrollments', practiceSlotGenerationRouter);
apiRouter.use('/admin/cohort-assignment', cohortAssignmentRouter);
