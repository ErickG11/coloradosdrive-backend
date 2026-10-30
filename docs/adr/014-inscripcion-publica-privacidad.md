# ADR 014 — Inscripción pública y privacidad (CC-01 / CC-02)

Estado: aceptado como decisión técnica; textos pendientes de revisión legal.

## Contexto

La solicitud precede a la cuenta de estudiante. El proyecto comparte Supabase entre entornos, por lo que la aplicación del SQL queda a cargo del responsable, con preflight, verificación reversible y rollback. No se cambia el wizard manual ni la asignación administrativa de Alumnos.

## Decisiones

- No consultar Registro Civil, MinEduc, CNE ni proveedores de identidad. La cédula se valida localmente; el administrador revisa documentos.
- Correo → código → consentimiento → datos → documentos → confirmación. Código con hash, intentos CAS, JWT temporal solo en memoria y progreso autenticado para reanudar.
- Consentimiento persistido por solicitud y versión del aviso; dos declaraciones obligatorias. De 15 a 17 se registra autorización, nombre y cédula del representante. Aviso y texto de representante son borradores sujetos a revisión legal. Menores de 15 no continúan.
- solicitada_at se fija una vez al guardar datos con consentimiento vigente; curso y fecha se conservan en reintentos y concurrencia. No usar fecha de aprobación para cohortes.
- Regla pública única en TypeScript: cierre de matrícula menos día de solicitud en Guayaquil >=5 días y cupo; primera por inicio de curso incluso antes de abrir matrícula. Si ninguna, pendiente_cohorte. Mantener regla manual anterior por compatibilidad.
- Mantener cuatro tipos documentales. titulo_bachiller se presenta como “Título de bachiller o certificado de décimo”. Faltantes no bloquean; papeleta exenta desde 65 inclusive. Checklist físico independiente, pendiente al aprobar.
- Bucket privado, firmas de contenido y tamaño; enlaces de 300 segundos solo bajo petición administrativa auditada. No firmar en el listado.
- SOLICITUD_RETENCION_DIAS configurable, 30 por defecto. Rechazadas desde revisión y abandonadas desde creación; conservar la regla de siete días para pendientes sin documentos. Contacto de derechos configurable con EMAIL_USER por defecto.
- Eliminación comparte helper Storage→SQL; auditoría sin FK al expediente y sin datos personales en su payload. Auditoría no se elimina al retirar la solicitud.
- Reclamar aprobación antes de Auth; finalizar checklist/estado/auditoría en una transacción SQL. Compensar errores confirmados; no borrar una cuenta ante resultado de red ambiguo sin consultar estado. Un fallo de correo no revierte aprobación/rechazo.

## Consecuencias y límites

La revisión sigue siendo humana y no certifica autenticidad externa. La aplicación necesita 037–039; no se aplican automáticamente. El esquema no implica que el texto legal haya sido aprobado. Los límites en memoria requieren un proceso único o un store compartido si se replica. Una caída de proceso durante Auth puede requerir recuperación manual. Los horarios, reservas temporales, precios comerciales y Kushki quedan fuera de este incremento.
