# F14: verificaciones del admin y listado seguro

SQL050 se entrega para aplicación manual después de 049, con preflight, verificación que
termina en ROLLBACK y rollback. No se aplica desde el repositorio.

- `registrar_verificacion_inscripcion` (solo service_role): bloquea la solicitud y solo acepta
  verificaciones sobre solicitudes `enviada` sin decisión en curso (SI435 si el estado no
  corresponde, SI409 si hay decisión en curso). La fila es append-only. Si es de estudios,
  `verificado` y el método habilita (decide el backend con `metodoHabilitaAprobacion`), fija
  `archivo_verificado_at` del certificado, que inicia el plazo de borrado de 30 días (F20).
- `guard_solicitud_edit` gana una excepción mínima: un UPDATE de `solicitud_documentos` que
  solo cambia `archivo_verificado_at` se permite aunque la solicitud ya esté enviada. Las
  demás reglas (retención, legacy de solo lectura, estados) no cambian.
- `listar_solicitudes_admin(estado, q, page, size)`: orden enviadas más antiguas, devueltas,
  decididas recientes, desempate por id. `q` se escapa (`\`, `%`, `_`) y se compara con
  `ilike ... escape '\'` como parámetro; no hay filtros PostgREST con texto del usuario.

Las notas de verificación son técnicas, sin datos personales (la UI y el validador lo
recuerdan). La frescura se evalúa al aprobar (F15) contra `datos_actualizados_at` y el
`uploaded_at` del certificado.
