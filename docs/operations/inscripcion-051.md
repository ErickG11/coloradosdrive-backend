# F15: decisiones del admin

SQL051 se entrega para aplicación manual después de 050, con preflight, verificación con
ROLLBACK y rollback. No se aplica desde el repositorio.

- `devolver_solicitud_inscripcion` y `rechazar_solicitud_inscripcion` (solo service_role) bloquean la
  solicitud y solo actúan desde `enviada` sin decisión en curso (SI435 / SI409). Devolver guarda
  motivo, mensaje (10–300) y nota interna; rechazar guarda motivo, el mensaje visible en
  `motivo_rechazo`, la nota interna y `reviewed_by/at`. VENCIDA no se acepta: solo la aplica el
  trabajo programado (F20).
- SPAM inserta en `correo_bloqueado` solo el hash HMAC del correo y nunca acorta un bloqueo mayor.
- `validar_aprobacion_inscripcion` comprueba lo que depende de datos persistidos: estado `enviada`,
  sin decisión en curso, correo verificado, consentimiento vigente (aviso y términos), datos completos,
  nivel admitido, edad actual del curso, representante, certificado obligatorio (un tope agotado no lo
  sustituye), y que las dos verificaciones indicadas sean las más recientes, `verificado` y posteriores
  a `datos_actualizados_at` y al `uploaded_at` del certificado; finalmente serializa y revalida la cédula
  con el lock `cedula_inscripcion:<cédula>`. Los MÉTODOS válidos se evalúan en TypeScript con
  `enrollmentCatalog.ts` (única fuente; `revision_visual` nunca habilita) sobre los mismos ids.
- Códigos nuevos: SI460 cédula ya registrada, SI461 identidad no verificada, SI462 estudios no verificados.
