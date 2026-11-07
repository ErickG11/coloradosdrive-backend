# 057 — conversión del estado al finalizar una aprobación

Diagnóstico estático: en052 finalizar_aprobacion_inscripcion recibe p_estado como
text, pero enrollments.status usa public.enrollment_status (001/013). INSERT con
una expresión text no obtiene automáticamente la conversión explícita de enum;
puede fallar con SQLSTATE42804 aunque las verificaciones estén correctas. PostgreSQL
lo explica en https://www.postgresql.org/docs/current/typeconv-query.html y
https://www.postgresql.org/docs/current/datatype-enum.html.

La captura/HTTP500 solo informa ERROR_INTERNO. No se ha obtenido el SQLSTATE real
ni consultado la base: este defecto está identificado en el código, pero no se
presenta como causa confirmada del intento del usuario. No repetir la aprobación
para diagnosticar sin revisar primero su estado; Auth pudo crearse o compensarse.

057 modifica únicamente el cuerpo de finalizar_aprobacion_inscripcion, cambiando
p_estado por p_estado::public.enrollment_status en el INSERT. Mantiene la firma,
validación de estados, transacción, checklist, auditoría, SECURITY INVOKER y ACL.
No edita052/055/056. La guarda de055 permanece activa. No crea ni corrige usuarios,
matrículas o reclamos existentes. No requiere056 (son funciones independientes).

Aplicación MANUAL por el operador, nunca desde esta tarea:
1. Pausar aprobaciones y revisar el estado de cualquier intento fallido.
2. Ejecutar inscripcion-057-preflight.sql (solo catálogo, ROLLBACK): exige052/055,
   enum correcto y cuerpo idéntico al de052 o al corregido. Si hubo cambios manuales,
   aborta para revisión; no sobrescribirlos. Lista ACL actual para revisión.
3. Aplicar migrations/057_aprobacion_estado_matricula.sql en transacción. Reaplicar
   es idempotente; el propio archivo repite el preflight y falla sin cambios.
4. Ejecutar inscripcion-057-verificacion.sql (catálogo, termina en ROLLBACK).
5. Revisar estado/reclamo antes de reintentar desde el panel. DISABLE_CRON=true en
   local impide recuperación programada; no limpiar reviewed_at a ciegas.

El backend ahora registra enrollment_request_failed para errores no operativos del
flujo: solo tipo/código/estado técnico mediante logSafeError. No registra mensaje,
SQL, payload, correo, cédula, contraseña ni token. La respuesta pública sigue siendo
genérica. Si vuelve a fallar, el código técnico del log permitirá distinguir42804,
permisos42501, objetos ausentes o errores de Auth sin divulgar datos personales.

Rollback MANUAL: pausar aprobaciones, ejecutar inscripcion-057-rollback.sql. Restaura
exactamente la función de052 y sus ACL; conserva datos y guarda055. Reintroduce el
defecto original, por lo que no es una reparación de expedientes fallidos.

Validación en esta tarea: revisión estática, typecheck y lint del backend. No se
escribieron/ejecutaron suites ni se ejecutaron los scripts SQL (remotos o embebidos).
La ejecución funcional de057 con ambos estados queda pendiente de autorización en
la fase final de pruebas; no confundir esta entrega con una migración ya aplicada.
