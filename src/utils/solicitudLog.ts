// Lista cerrada: ningún cuerpo, dato personal ni error del proveedor llega al log.
export function logSolicitudFailure(
  event:
    | 'verification_request_failed'
    | 'verification_email_failed'
    | 'received_email_failed'
    | 'approval_email_failed'
    | 'enrollment_rollback_failed'
    // B1 (F15)
    | 'return_email_failed'
    | 'rejection_email_failed'
    | 'approval_account_rollback_failed'
    | 'approval_claim_release_failed',
): void {
  console.error(JSON.stringify({ event }));
}
