# ADR 023: acceso desde el pago y gestión individual de cohortes

Decisión del dueño: 12/11/2026. Estado: aprobado. Cambio C09.

Una matrícula activa o finalizada, en etapa activa, con el pago completo y las fechas individuales demostradas habilita los módulos del alumno desde el pago. El inicio futuro de prácticas no retrasa el acceso. Se conserva el límite exclusivo de medianoche del día siguiente a `access_end_date` en America/Guayaquil y el bloqueo de identidad. El régimen histórico de matrículas sin guard de fechas sigue intacto.

La migración 087 elimina únicamente el límite inferior de `practice_start_date` en `private.legacy079_enrollment_has_access_v2`. Acepta el hash original o el hash de la misma corrección aplicada manualmente; falla ante cualquier otro cuerpo. No modifica `private.enrollment_has_access_v2`, pagos, matrículas ni fechas existentes. El middleware y el shell continúan leyendo `eligible`; el menú muestra todos los módulos cuando hay acceso y conserva Mi inscripción siempre.

Cohortes separa la información general y el aplazamiento en dos pestañas del panel derecho. La creación conserva sus campos y reglas. El aplazamiento exige motivo y conserva las comprobaciones SQL; una cohorte iniciada solo permite ampliar su fin de curso. Se conserva la oferta de notificar interesados después de abrir disponibilidad. La cancelación usa la operación existente con motivo, añade el conteo de alumnos que la bloquean y enlaza al listado filtrado.

Los precios por tipo salen de la configuración existente y se editan individualmente con motivo. Las reservas anteriores conservan su precio. Las asignaciones y transferencias se gestionan individualmente desde Matrículas en la ficha del alumno, mediante paneles derechos. Los destinos se limitan a matrícula abierta, mismo tipo y cupo disponible. La operación de transferencia conserva sus comprobaciones y su excepción explícita de fechas. La asignación usa el motor existente y un envoltorio transaccional que registra el motivo en `enrollment_domain_audit`; no crea un mecanismo de auditoría paralelo.

Aplicar después de 086: preflight 087, migración 087 y verificación 087 (termina en ROLLBACK). El rollback restaura los cuerpos originales y elimina únicamente el nuevo envoltorio de asignación. Los indicadores no se activan automáticamente. No se ofrece reasignación grupal en la interfaz.
