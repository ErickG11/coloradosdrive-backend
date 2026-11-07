import { createChain, type SupabaseChainMock } from './supabaseMock';

// Desde 81ff459 el middleware `authenticate` hace, para un alumno, dos consultas a
// supabaseAdmin.from(...) por petición (en este orden):
//   1. users (activo, debe_cambiar_password)       -> assertPasswordNotPendingChange
//   2. enrollments (matrículas de solicitud sin activar) -> inscripcionIncompleta
// La segunda se omite en las rutas de la lista cerrada `permiteInscripcionIncompleta`
// (account-status, notifications, estado-inscripcion y las rutas de reserva y pago).

/** Alumno activo con contraseña vigente (primera consulta). */
export function alumnoActivo(overrides: Record<string, unknown> = {}): SupabaseChainMock {
  return createChain({
    data: { activo: true, debe_cambiar_password: false, ...overrides },
    error: null,
  });
}

/** Alumno sin matrículas de solicitud pendientes: inscripción completa (segunda consulta). */
export function sinInscripcionPendiente(): SupabaseChainMock {
  return createChain({ data: [], error: null });
}

/** Alumno con una matrícula de solicitud sin activar: el acceso queda bloqueado (403). */
export function conInscripcionPendiente(
  etapa: 'por_agendar' | 'reservado' = 'por_agendar',
): SupabaseChainMock {
  return createChain({
    data: [{ id: 'enrollment-1', etapa_inscripcion: etapa, reserva_expira_at: null }],
    error: null,
  });
}

/** Encadena en `from` las dos consultas del middleware para un alumno con inscripción completa. */
export function mockSesionAlumno(from: jest.Mock): jest.Mock {
  return from.mockReturnValueOnce(alumnoActivo()).mockReturnValueOnce(sinInscripcionPendiente());
}
