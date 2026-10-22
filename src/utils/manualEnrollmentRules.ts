import { AppError } from './AppError';

// Mensajes (contrato visible) de las validaciones de la matrícula manual.
// Las de fecha de nacimiento, horas por día y plan de práctica viven en
// birthDate.ts, practiceHours.ts y manualPracticePlan.ts.
export const MANUAL_MESSAGES = {
  // Paso 1
  cedulaObligatoria: 'Ingresa la cédula.',
  cedula: 'Ingresa una cédula ecuatoriana válida de 10 dígitos.',
  nombreObligatorio: 'Ingresa el nombre completo.',
  nombreLargo: 'El nombre completo no puede superar 200 caracteres.',
  nombre: 'El nombre completo debe incluir letras y no puede contener números.',
  correoObligatorio: 'Ingresa el correo electrónico.',
  correoLargo: 'El correo no puede superar 254 caracteres.',
  correo: 'Ingresa un correo electrónico válido.',
  studentMode: 'Indica si el estudiante es nuevo o existente.',
  studentId: 'Selecciona un estudiante existente válido.',
  cedulaDuplicada: 'La cédula ya existe. Busca y selecciona el estudiante existente.',
  correoDuplicado: 'El correo ya existe. Busca y selecciona el estudiante existente.',
  duplicadosCuerpo: 'Indica la cédula, el correo o ambos.',
  // Paso 2
  tipoCurso: 'Selecciona un tipo de curso válido.',
  automatic: 'Indica si la cohorte se asigna automáticamente.',
  cohorte: 'Selecciona una cohorte válida.',
  cohorteNoExiste: 'La cohorte seleccionada no existe.',
  cohorteOtroCurso: 'La cohorte seleccionada no corresponde al curso elegido.',
  cohorteCerrada: 'La matrícula de la cohorte no está abierta.',
  cohorteLlena: 'La cohorte ya no tiene cupo disponible.',
  // Paso 3
  practice: 'Completa los datos de las prácticas.',
  semanas: 'Selecciona una duración de 1, 2 o 3 semanas.',
  modalidad: 'Selecciona una modalidad de práctica válida.',
  fechaInicioObligatoria: 'Ingresa la fecha de inicio.',
  horaObligatoria: 'Ingresa la hora deseada.',
  horasPorDiaObligatoria: 'Ingresa las horas por día.',
  instructor: 'Selecciona un instructor válido.',
  instructorObligatorio: 'Selecciona un instructor antes de confirmar.',
  // Paso 4
  modalidadPago: 'Selecciona la modalidad de pago.',
  descuento: 'El descuento debe ser un monto de 0 en adelante con hasta dos decimales.',
  montoAbonado: 'El monto abonado debe ser un monto de 0 en adelante con hasta dos decimales.',
  abonoCero: 'Con la modalidad Abono, el monto abonado debe ser mayor que $0.00.',
} as const;

export function manualError(
  message: string,
  field: string,
  status = 400,
  code = 'INVALID_FIELD',
): AppError {
  return new AppError(message, status, { code, field });
}
