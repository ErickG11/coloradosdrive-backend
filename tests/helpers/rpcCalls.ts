// Al responder un 403 con sesión, errorHandler avisa en segundo plano a la base
// (report_enrollment_security_v2). Es un efecto de seguridad esperado y no una operación de
// datos: las pruebas de "rechaza antes de tocar la base" deben ignorarlo.
const SECURITY_REPORT = 'report_enrollment_security_v2';

/** Llamadas RPC de datos: todas menos el aviso de seguridad de mejor esfuerzo. */
export function dataRpcCalls(rpc: jest.Mock): unknown[][] {
  const calls = rpc.mock.calls as unknown[][];
  return calls.filter((call) => call[0] !== SECURITY_REPORT);
}
