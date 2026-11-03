import { DateTime } from 'luxon';
import { solicitudError } from './solicitudError';
import { isValidCedulaEcuatoriana } from './cedula';
import { invalidField, normalizeName } from './solicitudFields';

export function calcularEdad(fecha: string, now: Date = new Date()): number {
  const today = DateTime.fromJSDate(now).setZone('America/Guayaquil');
  const birth = DateTime.fromISO(fecha, { zone: 'America/Guayaquil' });
  return today.year - birth.year - (today.month < birth.month || (today.month === birth.month && today.day < birth.day) ? 1 : 0);
}
export interface Representante { nombre: string; cedula: string; acepta: true }
export function validateApplicant(fecha: string, representante?: unknown, now?: Date, cedula?: string): Representante | null {
  const birth = DateTime.fromISO(fecha, {zone:'America/Guayaquil'});
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !birth.isValid) invalidField('fechaNacimiento','Ingresa una fecha de nacimiento real.','FECHA_INVALIDA');
  if (birth > DateTime.fromJSDate(now ?? new Date()).setZone('America/Guayaquil').endOf('day')) invalidField('fechaNacimiento','La fecha de nacimiento no puede ser futura.','FECHA_INVALIDA');
  const age = calcularEdad(fecha, now);
  if (!Number.isFinite(age) || age < 15) throw solicitudError('Debes tener al menos 15 años', 400, 'EDAD_MINIMA');
  if (age > 100) throw solicitudError('La edad máxima es de 100 años cumplidos', 400, 'EDAD_MAXIMA');
  if (age >= 18) return null;
  const rep = representante as Partial<Representante> | null | undefined;
  if (rep?.acepta !== true || typeof rep.nombre !== 'string' || !rep.nombre.trim() || rep.nombre.length > 200 ||
      typeof rep.cedula !== 'string' || !isValidCedulaEcuatoriana(rep.cedula) || rep.cedula === cedula) {
    throw solicitudError('Completa nombre, cédula válida y autorización del representante legal', 400, 'REPRESENTANTE_REQUERIDO');
  }
  return { nombre: normalizeName(rep.nombre, 'representanteNombre'), cedula: rep.cedula, acepta: true };
}
