# F10: consentimiento y términos versionados

Aplicación manual: 042 → 043 → 044 → 045 → 046. Ejecutar primero
`inscripcion-046-preflight.sql`, revisar `migrations/046_inscripcion_consentimiento_versionado.sql`
y, después de aplicarla, la verificación reversible `inscripcion-046-verificacion.sql`.
El agente no ejecuta SQL ni pruebas durante el método rápido autorizado.

GET `/public/aviso-privacidad` conserva version/contactoDerechos/retencionDias y
expone versionAviso, versionTerminos, enRevisionLegal, estadoLegal y los bloques
aviso/terminos en texto plano. Mostrar «BORRADOR: en revisión legal» de forma visible.
El texto menciona salud/tipo de sangre, finalidad, verificación, retención y derechos.
Las reglas de prácticas se limitan a las ya implementadas (SQL030–033); no añade
una pasarela de pagos ni promete un reembolso.

PUT `/solicitudes/:id/consentimiento` exige un token de edición válido y estado
borrador o devuelta. Cuerpo: versionAviso, versionTerminos, aceptoTratamiento=true,
declaraVeracidad=true, aceptoTerminos=true; representanteAcepta es un booleano opcional.
Rechaza campos desconocidos y coerciones. Versiones antiguas: 409 AVISO_DESACTUALIZADO
o TERMINOS_DESACTUALIZADOS. Devuelve version/versionAviso/versionTerminos/aceptadoAt.

La RPC bloquea la solicitud antes de guardar, comprueba estado y correo verificado
y audita sin datos personales. Una misma pareja de versiones conserva su primera
fecha; cambiar solo términos crea otra evidencia. No se presume aceptación legacy.
La unicidad anterior solicitud/aviso se sustituye por solicitud/aviso/términos.

Se añade representante_autoriza_tratamiento para registrar esa autorización antes
del paso de datos; se conserva el CHECK existente que exige nombre/cédula cuando
representante_acepta es true. F11 guardará los datos completos del representante.
Un reintento no revoca autorizaciones previas ni cambia la primera fecha de aceptación.

Variables: PRIVACY_NOTICE_VERSION y TERMS_VERSION (identificadores de 1–100
caracteres, letras/dígitos/punto/guion/guion bajo), TERMS_REFUND_TEXT (texto plano,
máximo 2000 caracteres, por defecto «en revisión legal»), PRIVACY_CONTACT_EMAIL,
SOLICITUD_RETENCION_DIAS. El nuevo aviso tiene por defecto 2026-11-borrador-v1.
Al cambiar el aviso, los términos o el bloque de reembolso, incrementar la versión
correspondiente en la configuración del despliegue. No cambiar .env desde esta tarea.
Los trabajos que materializan los plazos se completan en F20; no desplegar esta fase aislada.

Rollback: volver a backend anterior y revisar `inscripcion-046-rollback.sql`.
Si ya hay varias versiones de términos para un mismo aviso, el rollback aborta
sin borrar evidencia; conservar backend046 hasta planificar una reversión compatible.
Conserva la columna aditiva y su autorización. No altera extensiones, Storage ni Realtime.

Autorrevisión: S5 (objeto/campos/booleanos/versiones), S7/S8 (scope y estado), S9
(lock de fila y unicidad), S11 (no-store y auditoría sin PII), S16 (términos y aviso).
Comprobación estática únicamente; los casos de aceptación, abuso y concurrencia
quedan inventariados sin commit en inscripcion-pruebas-pendientes.md.
