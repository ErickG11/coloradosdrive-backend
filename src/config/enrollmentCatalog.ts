// Catálogo del flujo final. Los tipos legacy se conservan solo para lectura histórica.
export const NACIONALIDADES = [
  'ecuatoriana',
  'extranjero_con_cedula',
  'extranjero_sin_cedula',
] as const;
export type Nacionalidad = (typeof NACIONALIDADES)[number];
export const TIPOS_SANGRE = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'no_sabe'] as const;
export type TipoSangre = (typeof TIPOS_SANGRE)[number];
export const SUBTIPOS_CERTIFICADO = [
  'acta_grado',
  'copia_titulo',
  'certificado_promocion',
  'certificado_estudios',
  'resolucion_homologacion',
] as const;
export type SubtipoCertificado = (typeof SUBTIPOS_CERTIFICADO)[number];
export const ESTADOS_INSCRIPCION = [
  'borrador',
  'enviada',
  'devuelta',
  'aprobada',
  'rechazada',
] as const;
export type EstadoInscripcion = (typeof ESTADOS_INSCRIPCION)[number];
export const NIVELES_ESTUDIOS = {
  bachiller: {
    label: 'Bachiller',
    archivo: 'ninguno',
    permitido: true,
    subtipos: [],
  },
  bachiller_reciente: {
    label: 'Bachiller reciente',
    archivo: 'opcional',
    permitido: true,
    subtipos: ['acta_grado', 'copia_titulo'],
  },
  bachiller_exterior: {
    label: 'Bachiller en el exterior',
    archivo: 'obligatorio',
    permitido: true,
    subtipos: ['resolucion_homologacion'],
  },
  decimo_aprobado: {
    label: 'Décimo aprobado',
    archivo: 'obligatorio',
    permitido: true,
    subtipos: ['certificado_promocion'],
  },
  cursando_bachillerato: {
    label: 'Cursando bachillerato',
    archivo: 'obligatorio',
    permitido: true,
    subtipos: ['certificado_estudios'],
  },
  menos_de_decimo: { label: 'Menos de décimo', archivo: 'ninguno', permitido: false, subtipos: [] },
} as const satisfies Record<
  string,
  {
    label: string;
    archivo: 'ninguno' | 'opcional' | 'obligatorio';
    permitido: boolean;
    subtipos: readonly SubtipoCertificado[];
  }
>;
export type NivelEstudios = keyof typeof NIVELES_ESTUDIOS;
export const METODOS_VERIFICACION = [
  'registro_civil_portal',
  'registro_civil_web_service',
  'ministerio_portal',
  'codigo_qr_certificado',
  'llamada_institucion',
  'original_presencial',
  'revision_visual',
] as const;
export type MetodoVerificacion = (typeof METODOS_VERIFICACION)[number];
export type TipoVerificacion = 'identidad' | 'estudios';
export const RESULTADOS_VERIFICACION = ['verificado', 'no_coincide', 'no_encontrado'] as const;
export const METODOS_MANUALES_VERIFICACION = METODOS_VERIFICACION.filter(
  (m) => m !== 'registro_civil_web_service',
);
// I17: cualquier método del catálogo permite verificar ambos tipos; sigue siendo
// obligatorio el resultado verificado y la frescura de la última verificación.
export const METODOS_VALIDOS_APROBACION = {
  identidad: METODOS_VERIFICACION,
  bachiller: METODOS_VERIFICACION,
  certificado: METODOS_VERIFICACION,
} as const;
export function metodoHabilitaAprobacion(
  _tipo: TipoVerificacion,
  nivel: NivelEstudios,
  metodo: MetodoVerificacion,
): boolean {
  return NIVELES_ESTUDIOS[nivel].permitido && METODOS_VERIFICACION.includes(metodo);
}
export const MOTIVOS_DEVOLUCION = {
  DATOS_NO_COINCIDEN_REGISTRO_CIVIL:
    'Revisa tus nombres, apellidos y fecha de nacimiento: no coinciden con la consulta de identidad.',
  CEDULA_MAL_ESCRITA: 'Revisa y corrige el número de cédula.',
  TITULO_NO_ENCONTRADO_ADJUNTAR_DOCUMENTO:
    'No pudimos confirmar tus estudios. Revisa el nivel declarado y adjunta el certificado correspondiente.',
  DOCUMENTO_ILEGIBLE_O_INCOMPLETO:
    'El certificado no se puede leer o está incompleto. Adjunta una copia completa y legible.',
  REQUIERE_DOCUMENTO_ESTUDIOS:
    'Adjunta el certificado de estudios correspondiente para continuar la revisión.',
  OTRO: null,
} as const;
export type MotivoDevolucion = keyof typeof MOTIVOS_DEVOLUCION;
export const MOTIVOS_RECHAZO = {
  NO_CUMPLE_NIVEL_ESTUDIOS: {
    mensaje: 'Tu nivel de estudios no cumple los requisitos del curso.',
    enviarCorreo: true,
  },
  NO_CUMPLE_EDAD: { mensaje: 'Tu edad no cumple el requisito del curso.', enviarCorreo: true },
  SOLICITUD_DUPLICADA: {
    mensaje: 'La solicitud no puede continuar. Contacta a la escuela para revisar tu inscripción.',
    enviarCorreo: true,
  },
  DATOS_INCONSISTENTES_O_FALSOS: {
    mensaje: 'La solicitud no fue aprobada por inconsistencias en los datos.',
    enviarCorreo: false,
  },
  SPAM: {
    mensaje: 'La solicitud no fue aprobada. Contacta a la escuela para más información.',
    enviarCorreo: false,
  },
  OTRO: { mensaje: null, enviarCorreo: true },
  VENCIDA: {
    mensaje: 'Venció el plazo para corregir tu solicitud. Contacta a la escuela.',
    enviarCorreo: false,
  },
} as const;
export type MotivoRechazo = keyof typeof MOTIVOS_RECHAZO;
export const EDAD_EXENCION_VOTACION = 65;
export const DOCUMENTOS_FISICOS = [
  {
    tipo: 'tipo_sangre',
    label: 'Carné de tipo de sangre de la Cruz Roja',
    obligatorio: true,
    bloqueaPago: false,
  },
  {
    tipo: 'papeleta_votacion',
    label: 'Certificado de votación',
    obligatorio: true,
    bloqueaPago: false,
  },
  {
    tipo: 'titulo_bachiller',
    label: 'Original del certificado de estudios, si corresponde',
    obligatorio: true,
    bloqueaPago: false,
  },
  { tipo: 'cedula', label: 'Cédula original para cotejo', obligatorio: true, bloqueaPago: false },
] as const;
export const RETENCION_INSCRIPCION = {
  borradorDias: 7,
  devueltaDias: 15,
  certificadoVerificadoDias: 30,
  huerfanoDias: 1,
} as const;
export const LIMITES_CERTIFICADO = {
  bytes: 2097152,
  pixeles: 24_000_000,
  lado: 2000,
  calidad: 82,
  paginas: 10,
  concurrencia: 3,
  esperaMs: 10000,
} as const;
export const MENSAJE_DATOS_DUPLICADOS =
  'No pudimos continuar con estos datos. Si ya enviaste una solicitud o ya eres alumno, consulta el estado con tu correo o comunícate con la escuela.';
export const MENSAJE_VERIFICACION_CORREO = 'Te enviamos un código de verificación a tu correo';
// B1 (F15): días de bloqueo del correo tras rechazar por SPAM (solo se guarda su hash).
export const BLOQUEO_SPAM_DIAS = 30;
