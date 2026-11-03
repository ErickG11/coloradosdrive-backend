import { DateTime } from 'luxon';
import {
  NACIONALIDADES,
  TIPOS_SANGRE,
  NIVELES_ESTUDIOS,
  MOTIVOS_DEVOLUCION,
  MOTIVOS_RECHAZO,
  METODOS_MANUALES_VERIFICACION,
  RESULTADOS_VERIFICACION,
} from '../config/enrollmentCatalog';
import type {
  Nacionalidad,
  TipoSangre,
  NivelEstudios,
  SubtipoCertificado,
  MetodoVerificacion,
  TipoVerificacion,
  MotivoDevolucion,
  MotivoRechazo,
} from '../config/enrollmentCatalog';
import { requireKnownFields, sanitizeEnrollmentText } from './enrollmentSanitization';
import { invalidField, normalizeName, normalizePhone, validateCedula } from './solicitudFields';
import { calcularEdad } from './solicitudAge';

function enumValue<T extends string>(
  value: unknown,
  options: readonly T[],
  field: string,
  code = 'CAMPO_INVALIDO',
): T {
  if (typeof value !== 'string' || !options.includes(value as T))
    invalidField(field, 'Selecciona una opción válida.', code);
  return value as T;
}
function plainText(
  value: unknown,
  field: string,
  min: number,
  max: number,
  code = 'CAMPO_INVALIDO',
): string {
  if (typeof value !== 'string' || value.length > max * 8 + 1024)
    invalidField(field, 'Ingresa texto dentro del límite permitido.', code);
  const text = sanitizeEnrollmentText(value);
  if (Array.from(text).length < min || Array.from(text).length > max || /[<>]/u.test(text))
    invalidField(field, `Ingresa texto plano de ${String(min)} a ${String(max)} caracteres.`, code);
  return text;
}
export function validateNamePart(value: unknown, field: 'nombres' | 'apellidos'): string {
  const name = plainText(value, field, 2, 60, 'NOMBRE_INVALIDO');
  if (!/^\p{L}[\p{L}\p{M}]*(?:[ '\u2019-]\p{L}[\p{L}\p{M}]*)*$/u.test(name))
    invalidField(field, 'Usa solo letras, espacios, apóstrofe o guion.', 'NOMBRE_INVALIDO');
  return name;
}
export function validateEnrollmentBirthDate(
  value: unknown,
  edadMinima: number,
  now = new Date(),
): { fecha: string; edad: number } {
  if (!Number.isInteger(edadMinima) || edadMinima < 0 || edadMinima > 100)
    throw new Error('Edad mínima del curso inválida');
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    invalidField('fechaNacimiento', 'Ingresa una fecha de nacimiento real.', 'FECHA_INVALIDA');
  const fecha = value;
  const birth = DateTime.fromISO(fecha, { zone: 'America/Guayaquil' });
  const today = DateTime.fromJSDate(now).setZone('America/Guayaquil').startOf('day');
  if (!birth.isValid || birth > today)
    invalidField('fechaNacimiento', 'La fecha debe ser real y no futura.', 'FECHA_INVALIDA');
  const edad = calcularEdad(fecha, now);
  if (edad > 100)
    invalidField('fechaNacimiento', 'La edad máxima es de 100 años cumplidos.', 'EDAD_MAXIMA');
  if (edad < edadMinima)
    invalidField(
      'fechaNacimiento',
      `Debes tener al menos ${String(edadMinima)} años para este curso.`,
      'EDAD_MINIMA',
    );
  return { fecha, edad };
}
export function validateEducationLevel(value: unknown): Exclude<NivelEstudios, 'menos_de_decimo'> {
  const nivel = enumValue(
    value,
    Object.keys(NIVELES_ESTUDIOS) as NivelEstudios[],
    'nivelEstudios',
    'NIVEL_ESTUDIOS_INVALIDO',
  );
  if (nivel === 'menos_de_decimo')
    invalidField(
      'nivelEstudios',
      'Necesitas haber aprobado al menos décimo para inscribirte.',
      'NIVEL_ESTUDIOS_NO_ADMITIDO',
    );
  return nivel;
}
export function validateCertificateSubtype(
  nivel: NivelEstudios,
  value: unknown,
): SubtipoCertificado {
  const permitidos: readonly SubtipoCertificado[] = NIVELES_ESTUDIOS[nivel].subtipos;
  return enumValue(value, permitidos, 'subtipo', 'SUBTIPO_CERTIFICADO_INVALIDO');
}
export interface EnrollmentPersonalData {
  nombres: string;
  apellidos: string;
  nombreCompleto: string;
  cedula: string;
  fechaNacimiento: string;
  telefono?: string;
  nacionalidadTipo: Exclude<Nacionalidad, 'extranjero_sin_cedula'>;
  tipoSangre: TipoSangre;
  nivelEstudios?: Exclude<NivelEstudios, 'menos_de_decimo'>;
  representante?: { nombre: string; cedula: string; acepta: true };
}
export function validateEnrollmentData(
  value: unknown,
  edadMinima: number,
  now = new Date(),
): EnrollmentPersonalData {
  requireKnownFields(value, [
    'nombres',
    'apellidos',
    'cedula',
    'fechaNacimiento',
    'telefono',
    'nacionalidadTipo',
    'tipoSangre',
    'nivelEstudios',
    'representante',
  ]);
  const nacionalidadTipo = enumValue(value.nacionalidadTipo, NACIONALIDADES, 'nacionalidadTipo');
  if (nacionalidadTipo === 'extranjero_sin_cedula')
    invalidField(
      'nacionalidadTipo',
      'Atendemos tu inscripción por WhatsApp.',
      'ATENCION_POR_CONTACTO',
    );
  const nombres = validateNamePart(value.nombres, 'nombres');
  const apellidos = validateNamePart(value.apellidos, 'apellidos');
  validateCedula(value.cedula);
  const birth = validateEnrollmentBirthDate(value.fechaNacimiento, edadMinima, now);
  const telefono = normalizePhone(value.telefono);
  const tipoSangre = enumValue(value.tipoSangre, TIPOS_SANGRE, 'tipoSangre');
  const nivelEstudios =
    value.nivelEstudios === undefined ? undefined : validateEducationLevel(value.nivelEstudios);
  let representante: EnrollmentPersonalData['representante'];
  if (birth.edad < 18) {
    if (value.representante === undefined)
      invalidField(
        'representante',
        'Completa los datos y autorización del representante.',
        'REPRESENTANTE_REQUERIDO',
      );
    requireKnownFields(value.representante, ['nombre', 'cedula', 'acepta'], 'representante');
    const rep = value.representante;
    if (rep.acepta !== true)
      invalidField(
        'representanteAcepta',
        'El representante debe autorizar la inscripción.',
        'REPRESENTANTE_REQUERIDO',
      );
    validateCedula(rep.cedula, 'representanteCedula');
    if (rep.cedula === value.cedula)
      invalidField(
        'representanteCedula',
        'La cédula del representante debe ser distinta.',
        'REPRESENTANTE_REQUERIDO',
      );
    representante = {
      nombre: normalizeName(rep.nombre, 'representanteNombre'),
      cedula: rep.cedula,
      acepta: true,
    };
  } else if (value.representante !== undefined)
    invalidField(
      'representante',
      'No se requieren datos del representante para una persona adulta.',
      'REPRESENTANTE_NO_APLICA',
    );
  return {
    nombres,
    apellidos,
    nombreCompleto: `${nombres} ${apellidos}`,
    cedula: value.cedula,
    fechaNacimiento: birth.fecha,
    nacionalidadTipo,
    tipoSangre,
    ...(telefono ? { telefono } : {}),
    ...(nivelEstudios ? { nivelEstudios } : {}),
    ...(representante ? { representante } : {}),
  };
}
export function validateVerificationCode(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9]{6}$/.test(value))
    invalidField(
      'codigo',
      'El código debe tener exactamente 6 dígitos.',
      'CODIGO_INVALIDO_O_VENCIDO',
    );
  return value;
}
export interface EnrollmentAdminDecision {
  accion: 'aprobar' | 'devolver' | 'rechazar';
  motivoCodigo: MotivoDevolucion | Exclude<MotivoRechazo, 'VENCIDA'> | null;
  mensaje: string | null;
  notaInterna: string | null;
}
export function validateEnrollmentDecision(value: unknown): EnrollmentAdminDecision {
  requireKnownFields(value, ['accion', 'motivoCodigo', 'mensaje', 'notaInterna']);
  const accion = enumValue(value.accion, ['aprobar', 'devolver', 'rechazar'], 'accion');
  const notaInterna =
    value.notaInterna === undefined ? null : plainText(value.notaInterna, 'notaInterna', 0, 1000);
  if (accion === 'aprobar') {
    if (value.motivoCodigo !== undefined || value.mensaje !== undefined)
      invalidField(
        'motivoCodigo',
        'La aprobación no admite un motivo de devolución o rechazo.',
        'MOTIVO_NO_APLICA',
      );
    return { accion, motivoCodigo: null, mensaje: null, notaInterna };
  }
  const motivos: readonly string[] =
    accion === 'devolver'
      ? Object.keys(MOTIVOS_DEVOLUCION)
      : Object.keys(MOTIVOS_RECHAZO).filter((c) => c !== 'VENCIDA');
  const motivoCodigo = enumValue(
    value.motivoCodigo,
    motivos,
    'motivoCodigo',
    'MOTIVO_INVALIDO',
  ) as Exclude<EnrollmentAdminDecision['motivoCodigo'], null>;
  let mensaje: string | null;
  if (motivoCodigo === 'OTRO') mensaje = plainText(value.mensaje, 'mensaje', 10, 300);
  else {
    if (value.mensaje !== undefined)
      invalidField('mensaje', 'Este motivo ya tiene un mensaje predefinido.', 'MENSAJE_NO_APLICA');
    mensaje =
      accion === 'devolver'
        ? MOTIVOS_DEVOLUCION[motivoCodigo as MotivoDevolucion]
        : MOTIVOS_RECHAZO[motivoCodigo as MotivoRechazo].mensaje;
  }
  return { accion, motivoCodigo, mensaje, notaInterna };
}
export function validateAdminVerification(value: unknown): {
  tipo: TipoVerificacion;
  metodo: MetodoVerificacion;
  resultado: (typeof RESULTADOS_VERIFICACION)[number];
  nota: string | null;
} {
  requireKnownFields(value, ['tipo', 'metodo', 'resultado', 'nota']);
  return {
    tipo: enumValue(value.tipo, ['identidad', 'estudios'], 'tipo'),
    metodo: enumValue(value.metodo, METODOS_MANUALES_VERIFICACION, 'metodo', 'METODO_INVALIDO'),
    resultado: enumValue(value.resultado, RESULTADOS_VERIFICACION, 'resultado'),
    nota: value.nota === undefined ? null : plainText(value.nota, 'nota', 0, 1000),
  };
}
