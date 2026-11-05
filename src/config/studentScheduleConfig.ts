// Límites compatibles con las cotas defensivas SQL059; no requiere secretos.
export interface StudentScheduleConfig {
  RESERVA_TTL_MINUTES: number;
  RESERVA_MAX_EXTENSIONES: number;
  RESERVA_EXTENSION_MINUTES: number;
  RESERVA_MAX_POR_DIA: number;
  PAGO_GRACIA_MINUTES: number;
  COHORT_MARGIN_DAYS: number;
}
export function loadStudentScheduleConfig(source: NodeJS.ProcessEnv): StudentScheduleConfig {
  function integer(name: string, fallback: number, min: number, max: number): number {
    const provided = source[name]?.trim();
    const raw = provided === undefined || provided === '' ? String(fallback) : provided;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max)
      throw new Error(`${name} debe ser un entero entre ${String(min)} y ${String(max)}`);
    return value;
  }
  return {
    RESERVA_TTL_MINUTES: integer('RESERVA_TTL_MINUTES', 15, 1, 15),
    RESERVA_MAX_EXTENSIONES: integer('RESERVA_MAX_EXTENSIONES', 1, 0, 1),
    RESERVA_EXTENSION_MINUTES: integer('RESERVA_EXTENSION_MINUTES', 10, 1, 10),
    RESERVA_MAX_POR_DIA: integer('RESERVA_MAX_POR_DIA', 3, 1, 3),
    PAGO_GRACIA_MINUTES: integer('PAGO_GRACIA_MINUTES', 10, 1, 10),
    COHORT_MARGIN_DAYS: integer('COHORT_MARGIN_DAYS', 5, 0, 60),
  };
}
