export interface PracticeRatingPendingItem {
  practiceSlotId: string;
  instructorName: string;
  scheduledAt: string;
  opensAt: string;
  closesAt: string;
}

export interface PracticeRatingSubmission {
  id: string;
  practiceSlotId: string;
  score: number;
  comment: string | null;
  createdAt: string;
}

export interface InstructorRatingSummary {
  instructorId: string;
  instructorName: string;
  active: boolean;
  average: number | null;
  responses: number;
  rankingEligible: boolean;
  label: string | null;
}

export interface InstructorRatingDetail {
  instructorId: string;
  average: number | null;
  responses: number;
  rankingEligible: boolean;
  label: string | null;
  items: { score: number; comment: string | null }[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PracticeRatingPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
