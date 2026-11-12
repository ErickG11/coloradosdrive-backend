/** Puerto de lectura: una respuesta incierta jamás autoriza cobro, liberación ni matrícula. */
export type ReconciliationResult = 'NO_OPERATIVA' | 'CONSULTA_FALLIDA' | 'INCIERTO' | 'RESUELTO';
export interface ReconciliationPort {
  status(input: { paymentId: string; reference: string | null }): Promise<ReconciliationResult>;
}
/** PENDIENTE: habilitar Analytics en el comercio y validar su contrato antes de conectar. */
export class UnavailableKushkiReconciliation implements ReconciliationPort {
  async status(): Promise<ReconciliationResult> {
    return 'NO_OPERATIVA';
  }
}
