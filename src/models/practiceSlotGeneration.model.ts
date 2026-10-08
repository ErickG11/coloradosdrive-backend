export const MODALIDADES = ['entre_semana', 'fin_de_semana'] as const;
export type Modalidad = (typeof MODALIDADES)[number];

// Parámetros base compartidos por sugerir-practica y confirmar-practica:
// confirmar-practica los recibe de nuevo (no un id de propuesta) para
// recalcular la lista de fechas de forma determinista en el servidor, en
// vez de confiar en un array de fechas que venga del cliente.
export interface GenerarPracticaBaseInput {
  fechaInicio: string;
  modalidad: Modalidad;
  horasPorDia: number;
  durationMinutes?: 60;
  // Exactamente uno de los dos.
  fechaFin?: string;
  numeroSesiones?: number;
}

export interface SugerirPracticaInput extends GenerarPracticaBaseInput {
  horaDeseada: string;
}

export interface InstructorSugerido {
  id: string;
  nombreCompleto: string;
}

export interface SugerirPracticaResult {
  fechas: string[];
  horaDeseada: string;
  horaResuelta: string;
  // true si horaResuelta != horaDeseada (no se pudo cumplir la hora
  // pedida y se buscó una hora adyacente con instructor libre).
  horaAjustada: boolean;
  instructoresSugeridos: InstructorSugerido[];
  totalSesiones: number;
  horasProgramadas: number;
  horasRequeridas: number | null;
}

export interface ConfirmarPracticaInput extends GenerarPracticaBaseInput {
  horaResuelta: string;
  instructorId: string;
}

export interface ConfirmarPracticaResult {
  slotsCreados: number;
  horasProgramadas: number;
  horasRequeridas: number | null;
  slotIds: string[];
}
