import type { IndividualDatesSource } from './enrollmentFoundation.model';
import type { EnrollmentStatus } from '../config/database.types';
export interface IndividualEnrollmentAccess {
  active: boolean;
  serverNow: string;
  enrollments: {
    id: string;
    courseId: string;
    type: 'A' | 'B';
    status: EnrollmentStatus;
    eligible: boolean;
    practiceStartDate: string | null;
    practiceEndDate: string | null;
    accessEndDate: string | null;
    paidAmountCentavos: number | null;
    datesSource: IndividualDatesSource | null;
    guardReady: boolean;
  }[];
}
