import { DateTime } from 'luxon';
import { solicitudError } from './solicitudError';
import { isValidCedulaEcuatoriana } from './cedula';

export function calcularEdad(fecha: string, now: Date = new Date()): number {
  const today = DateTime.fromJSDate(now).setZone('America/Guayaquil');
  const birth = DateTime.fromISO(fecha, { zone: 'America/Guayaquil' });
  return today.year - birth.year - (today.month < birth.month || (today.month === birth.month && today.day < birth.day) ? 1 : 0);
}
export interface Representante { nombre: string; cedula: string; acepta: true }
export function validateApplicant(fecha: string, representante?: unknown, now?: Date): Representante | null {
  const age = calcularEdad(fecha, now);
  if (!Number.isFinite(age) || age < 15) throw solicitudError('Debes tener al menos 15 años', 400, 'EDAD_MINIMA');
  if (age >= 18) return null;
  const rep = representante as Partial<Representante> | null | undefined;
  if (rep?.acepta !== true || typeof rep.nombre !== 'string' || !rep.nombre.trim() || rep.nombre.length > 200 ||
      typeof rep.cedula !== 'string' || !isValidCedulaEcuatoriana(rep.cedula)) {
    throw solicitudError('Completa nombre, cédula válida y autorización del representante legal', 400, 'REPRESENTANTE_REQUERIDO');
  }
  return { nombre: rep.nombre.trim(), cedula: rep.cedula, acepta: true };
}
