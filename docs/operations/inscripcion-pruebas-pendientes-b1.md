# Deuda de pruebas B1 (no se escribió ni ejecutó ninguna prueba)

## F14
- Felices: lista con cada estado, orden (enviadas más antiguas, devueltas, decididas recientes, desempate por id),
  paginación; detalle completo con curso, certificado, consentimiento y verificaciones (con `vigente`);
  verificación identidad/estudios 201; URL firmada 300 s con `download` y fila de auditoría `abrir_certificado`.
- Errores: estado fuera de lista (400), page/pageSize fuera de rango, id no UUID, solicitud en borrador (404),
  verificación sobre devuelta/aprobada (409 ESTADO_INCORRECTO), con decisión en curso (409 SOLICITUD_CERRADA),
  método `registro_civil_web_service` (METODO_INVALIDO), campos desconocidos, nota con `<`, sin certificado (404).
- Abuso: q con `%`, `_`, `\`, comas, paréntesis, puntos y comillas no inyecta ni coincide con todo; q de 10 000 caracteres.
- Concurrencia: dos verificaciones simultáneas (ambas se insertan, la más reciente manda); verificación vs. decisión.
- Permisos: estudiante, instructor, sin sesión y admin sin MFA (cuando ADMIN_MFA_REQUIRED) en cada endpoint.
- SQL (PGlite): trigger append-only, excepción de `guard_solicitud_edit` solo para `archivo_verificado_at`,
  `registrar_verificacion_inscripcion` fija `archivo_verificado_at` solo con método habilitante y `verificado`.
- Frescura: verificación anterior a `datos_actualizados_at` o al `uploaded_at` del certificado => `vigente=false`.

## F15
- Devolver/rechazar/aprobar felices; correo de devolver con texto fijo sin datos; rechazos sin correo (DATOS_INCONSISTENTES_O_FALSOS, SPAM).
- SPAM guarda solo el hash HMAC 30 días (no se acorta); correo bloqueado no recibe código (F09).
- Abuso: VENCIDA desde el admin (400), mensaje con motivo predefinido (MENSAJE_NO_APLICA), OTRO sin mensaje, nota con '<'.
- Concurrencia Promise.all: aprobar+devolver, aprobar+aprobar, devolver+rechazar: una sola gana, la otra 409.
- Aprobar rechaza: sin verificación, revision_visual, método de otro tipo, verificación anterior a datos_actualizados_at o al certificado,
  consentimiento desactualizado, certificado obligatorio ausente o pendiente por cupo, cédula duplicada (lock cedula_inscripcion).

## F16
- Cuenta sin contraseña con app_metadata.role; perfil con no_sabe -> tipo_sangre NULL; enrollment origen=solicitud y requisitos_verificados_at;
  cohorte por regla de 5 días o pendiente_cohorte; reintento ante CD001; compensación (cuenta y reclamación) ante fallo; respuesta perdida
  tras finalizar (APROBACION_NO_CONFIRMADA); el correo contiene solo origen de FRONTEND_URL y token_hash (nunca action_link ni contraseña).
- Fallo de correo no deshace la aprobación (correoEnviado=false).

## F17
- Reenvío: alumno de solicitud aprobada; 404 si no; 409 si inactivo; 429 antes de 60 s; auditoría; permisos solo admin.

## F20
- Vencida a los 15 días (VENCIDA, sin correo); borrador 7 d; rechazada 30 d desde la decisión (reloj simulado, America/Guayaquil);
  certificado verificado 30 d (queda la fila con archivo_eliminado_at); huérfanos > 1 día; fallo de Storage conserva rutas y libera reclamación.
- DELETE: aprobada 409, borrador 404, enviada con decisión en curso 409, borra Storage y filas, auditado; helper único compartido con el job.
- SQL (PGlite): vencer_solicitudes_devueltas, listar_objetos_huerfanos_solicitudes (requiere storage.objects simulado).
