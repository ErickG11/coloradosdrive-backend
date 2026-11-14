import type { StudentScheduleReservation } from './studentSchedule.model';
import type { ReservationPlanSummary } from '../utils/studentFixedPlan';
export interface PlanChangeState {
  active: boolean;
  calendarEndDate?: string | null;
  studentId?: string;
  canChange?: boolean;
  reasonCode?: string | null;
  reason?: string;
  serverNow?: string;
  windowClosesAt?: string | null;
  freeRemaining?: number;
  reservation?: StudentScheduleReservation | null;
  current?: {
    practiceStartDate: string | null;
    practiceEndDate: string | null;
    accessEndDate: string | null;
  };
}
export interface PlanChangePreview {
  factible: boolean;
  franjas: { scheduledAt: string }[];
  precioCentavos: number;
  serverNow: string;
}
export interface BulkReassignmentResult {
  preview: boolean;
  canApply: boolean;
  plans: { enrollmentId: string; reservation: StudentScheduleReservation }[];
}

export interface AdminReassignmentSource {
  active: boolean;
  serverNow?: string;
  cohort?: { id: string; type: 'A' | 'B' };
  enrollments?: {
    id: string;
    studentId: string;
    studentName: string;
    updatedAt: string;
    practiceStartDate: string | null;
    practiceEndDate: string | null;
    guardReady: boolean;
  }[];
}

export interface PlanChangeCalendar {
  serverNow: string;
  dias: { fecha: string; disponible: boolean; motivo?: string | null }[];
}

export interface PlanChangePreviewWithPlan extends PlanChangePreview {
  plan: ReservationPlanSummary | null;
}
