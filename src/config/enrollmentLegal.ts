import { env } from './env';
import { PRIVACY_NOTICE_VERSION, TERMS_VERSION } from './privacy';

interface LegalDocument {
  titulo: string;
  secciones: { titulo: string; texto: string }[];
}
export interface EnrollmentLegalContent {
  version: string;
  versionAviso: string;
  versionTerminos: string;
  contactoDerechos: string;
  retencionDias: number;
  estadoLegal: string;
  enRevisionLegal: boolean;
  aviso: LegalDocument;
  terminos: LegalDocument;
}

// Texto plano para que cada cliente lo presente sin HTML ni enlaces de terceros.
// BORRADOR: publicar una revisión exige incrementar la versión correspondiente.
export function privacyContent(): EnrollmentLegalContent {
  return {
    version: PRIVACY_NOTICE_VERSION,
    versionAviso: PRIVACY_NOTICE_VERSION,
    versionTerminos: TERMS_VERSION,
    contactoDerechos: env.PRIVACY_CONTACT_EMAIL,
    retencionDias: env.SOLICITUD_RETENCION_DIAS,
    estadoLegal: 'BORRADOR: en revisión legal',
    enRevisionLegal: true,
    aviso: {
      titulo: 'Aviso de privacidad para la inscripción en línea',
      secciones: [
        {
          titulo: 'Datos y finalidad',
          texto:
            'ColoradosDrive utiliza tu correo, nombres, apellidos, cédula, fecha de nacimiento, teléfono opcional, nacionalidad y nivel de estudios para tramitar tu inscripción, verificar identidad y estudios, responderte y crear tu cuenta si se aprueba. Solo se solicita un certificado de estudios cuando corresponde a tu nivel.',
        },
        {
          titulo: 'Dato de salud',
          texto:
            'El tipo de sangre es un dato de salud. Se solicita para preparar los requisitos de tu licencia. Si no lo conoces puedes indicar «No lo sé» y presentar el carné de tipo de sangre de la Cruz Roja en la escuela. No se solicita una imagen del carné en este formulario.',
        },
        {
          titulo: 'Verificación y acceso',
          texto:
            'El personal autorizado contrasta tu identidad y estudios con las fuentes oficiales o los métodos de verificación previstos por la escuela. El certificado digital es privado. No subas cédula, papeleta de votación ni carné de sangre. Si eres menor de edad, tu representante debe autorizar el tratamiento y proporcionar los datos exigidos.',
        },
        {
          titulo: 'Conservación',
          texto: `Los borradores se conservan siete días. Una solicitud devuelta permite corregir durante quince días y luego vence. Los datos y archivos de una solicitud rechazada se eliminan a los ${String(env.SOLICITUD_RETENCION_DIAS)} días. El certificado se elimina treinta días después de verificarse, conservando el registro técnico de la verificación. Los datos necesarios de una inscripción aprobada se incorporan a tu expediente de alumno.`,
        },
        {
          titulo: 'Derechos y contacto',
          texto: `Para solicitar acceso, rectificación o eliminación de tus datos, o plantear una consulta sobre su tratamiento, escribe a ${env.PRIVACY_CONTACT_EMAIL}. La escuela verificará tu identidad antes de atender la solicitud y te informará si debe conservar parte del expediente.`,
        },
      ],
    },
    terminos: {
      titulo: 'Términos de la inscripción y uso de la plataforma',
      secciones: [
        {
          titulo: 'Solicitud y veracidad',
          texto:
            'Declara datos verdaderos y revisa tu solicitud antes de enviarla. El envío inicia una revisión; la aprobación la comunica la escuela. No compartas el código de tu correo ni el acceso a tu cuenta.',
        },
        {
          titulo: 'Prácticas, cambios y cancelación',
          texto:
            'Los cambios de prácticas dependen de los cupos disponibles y de las condiciones mostradas antes de confirmar. El sistema controla un máximo de dos reprogramaciones por matrícula. La cancelación requiere indicar un motivo y muestra su efecto antes de confirmarla. Una cancelación no implica automáticamente un reembolso.',
        },
        {
          titulo: 'Asistencia',
          texto:
            'El instructor registra la asistencia y las incidencias de cada práctica. Consulta el resultado en tu cuenta y comunica a la escuela cualquier discrepancia.',
        },
        { titulo: 'Política de reembolso', texto: env.TERMS_REFUND_TEXT },
      ],
    },
  };
}
