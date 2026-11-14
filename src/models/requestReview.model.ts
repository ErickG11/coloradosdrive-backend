export interface RequestReviewState {
  active: boolean;
  failedEmails?: number;
  serverNow?: string;
  owned?: boolean;
  token?: string | null;
  until?: string | null;
  updatedAt?: string;
  archivedAt?: string | null;
  studentId?: string | null;
  enrollmentId?: string | null;
  revokedAt?: string | null;
  paymentReview?: boolean;
}
export interface RequestRetentionPolicy {
  borradorDias: number;
  devueltaDias: number;
  certificadoVerificadoDias: number;
  huerfanoDias: number;
  rechazadaDias: number | null;
  aprobadaDias: null;
  archivadaDias: null;
}
export interface RequestEmailClaim {
  id: string;
  requestId: string;
  token: string;
  kind: 'devuelta' | 'rechazada' | 'archivada' | 'revocada';
  to: string;
}
