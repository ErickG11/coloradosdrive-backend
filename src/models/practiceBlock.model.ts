export interface PracticeBlock {
  enrollmentId: string;
  cohortId: string;
  date: string;
  slotIds: string[];
  startsAt: string;
  endsAt: string;
  hours: number;
  instructorId: string;
  confirmed: boolean;
  started: boolean;
}
export interface PracticeBlockPreview {
  block: PracticeBlock;
  result: 'reprogramable' | 'hora_perdida' | 'falta';
  used: number;
  remaining: number;
  started: boolean;
  effect: string;
}
export interface PracticeBlockOption {
  id: string;
  enrollmentId: string;
  cohortId: string;
  startsAt: string;
  endsAt: string;
  hours: number;
  instructorId: string;
  instructorName: string;
  kind: 'released' | 'instructor_free' | 'other_free';
  sourceDate: string | null;
  sourceStartsAt: string | null;
  pendingId: string | null;
  cost: number;
  remaining: number;
}
export interface PracticeBlockEnrollment {
  id: string;
  cohortId: string;
  used: number;
  remaining: number;
  targetHours: number;
  endDate: string;
  reservedHours: number;
  attendedHours: number;
  pending: { id: string; date: string; startsAt: string; hours: number; instructorId: string }[];
  absences: { id: string; date: string; startsAt: string; hours: number }[];
}
export interface PracticeBlockSummary {
  enrollments: PracticeBlockEnrollment[];
}
export interface PracticeBlockMutation extends Record<string, unknown> {
  cohortId: string;
  audience: string[];
  used: number;
  remaining: number;
  effect?: string;
  result?: PracticeBlockPreview['result'];
  block?: PracticeBlock;
}
export interface AdminPracticeAbsence {
  studentId: string;
  name: string;
  count: number;
  enrollments: {
    id: string;
    used: number;
    absences: { id: string; date: string; startsAt: string; hours: number }[];
  }[];
}
export interface PracticeBlockFreeHour {
  startsAt: string;
  endsAt: string;
  hours: number;
  instructorId: string;
  instructorName: string;
}
export interface PracticeBlockResolutionPreview {
  block: PracticeBlock;
  started: boolean;
  late: boolean;
  used: number;
  remaining: number;
  canMove: boolean;
  moveReason: string | null;
  freeHours: PracticeBlockFreeHour[];
  effectMove: string;
  effectAbsence: string;
}
export interface PracticeBlockResolution extends Record<string, unknown> {
  cohortId: string;
  audience: string[];
  block: PracticeBlock;
  action: 'mover' | 'falta';
  result: 'reprogramado' | 'falta';
  used: number;
  remaining: number;
  cancellationId: string;
  effect: string;
  newBlock: { startsAt: string; endsAt: string; hours: number; instructorId: string } | null;
}
