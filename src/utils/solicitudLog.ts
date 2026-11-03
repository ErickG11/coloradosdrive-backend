// Lista cerrada: ningún cuerpo, dato personal ni error del proveedor llega al log.
export function logSolicitudFailure(
  event:
    | 'verification_request_failed'
    | 'verification_email_failed'
    | 'received_email_failed'
    | 'approval_email_failed'
    | 'enrollment_rollback_failed',
): void {
  console.error(JSON.stringify({ event }));
}
