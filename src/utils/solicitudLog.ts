// Lista cerrada: ningún cuerpo, dato personal ni error del proveedor llega al log.
export function logSolicitudFailure(event: 'verification_email_failed' | 'approval_email_failed' | 'enrollment_rollback_failed'): void {
  console.error(JSON.stringify({ event }));
}
