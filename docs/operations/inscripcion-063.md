# I17 · datos obligatorios y nivel vigente

Aplicación MANUAL, después de062. No se ejecutó SQL remoto. Antes desplegar juntos
el backend y el frontend I17. Preflight: inscripcion-063-preflight.sql (solo lectura,
termina en ROLLBACK); exige dos cuerpos conocidos normalizados sin CR. Si cambió
manualmente una función, detenerse y reconciliar, sin editar hashes a ciegas.

Aplicar migrations/063_inscripcion_datos_obligatorios.sql, luego ejecutar
inscripcion-063-verificacion.sql: datos aislados, guardado/envío con teléfono,
rechazo de prefijos/separadores/nivel retirado, ACL y ROLLBACK. El arnés F45 realiza
estos pasos solo en Postgres embebido. La migración es repetible y no cambia filas,
CHECK, auditoría, RLS ni funciones de extensiones. Rollback manual:
inscripcion-063-rollback.sql, solo desde el cuerpo revisado, coordinando versión de API.

No hace falta sustituir SQL por métodos de aprobación: 051 ya exige el resultado
verificado más reciente y vigente sin filtrar método. La distinción estaba en
TypeScript y se elimina allí, conservando la frescura. Los indicadores públicos
solo reflejan el último resultado y no son una autorización para aprobar.

Revisar manualmente: 7 campos obligatorios y errores por campo, teléfonos locales,
checksum, edad mínima/representante, conflicto genérico; nivel décimo y certificado;
última verificación positiva/negativa sin filtrar métodos ni revelar notas/actor;
aprobar con original_presencial y revision_visual y comprobar auditoría append-only.
