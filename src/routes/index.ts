import { Router } from 'express';

import { cohortRouter } from './cohort.routes';
import { healthRouter } from './health.routes';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/cohorts', cohortRouter);
