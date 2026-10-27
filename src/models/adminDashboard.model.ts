export interface DashboardSection<T> {
  data: T | null;
  error: string | null;
}
export interface DashboardCurrent {
  activeStudents: number;
  balance: number;
  unpricedEnrollments: number;
  pendingCohort: number;
  distribution: { key: string; label: string; value: number }[];
  enrollmentStates: { status: string; value: number }[];
}
export interface DashboardActivity {
  newEnrollments: number;
  completedPractices: number;
  enrollmentTrend: number | null;
  practiceTrend: number | null;
  comparison: string;
  series: { month: string; enrollments: number; practices: number }[];
  recentEnrollments: {
    id: string;
    studentId: string;
    name: string;
    courseType: 'A' | 'B';
    date: string;
    status: string;
    cohort: string | null;
  }[];
  academic: {
    studentsWithAttempts: number;
    completedAttempts: number;
    passedAttempts: number;
    averageScore: number | null;
    practiceHours: number;
  };
}
export interface DashboardAgenda {
  days: { date: string; count: number }[];
  totalForDay: number;
  slots: {
    id: string;
    date: string;
    duration: number;
    status: string;
    studentId: string | null;
    student: string;
    instructor: string;
    cohort: string;
  }[];
}
export interface AdminDashboardSummary {
  generatedAt: string;
  timezone: string;
  month: string;
  day: string;
  period: { from: string; to: string; partial: boolean };
  current: DashboardSection<DashboardCurrent>;
  activity: DashboardSection<DashboardActivity>;
  agenda: DashboardSection<DashboardAgenda>;
  documents: DashboardSection<{ studentsPending: number }>;
}
