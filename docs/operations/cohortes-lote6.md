> Contrato vigente D3 (12/11/2026): los vehículos no limitan. Las referencias a límites físicos en resultados históricos describen versiones anteriores; no se activan ni se configuran. La capacidad actual son los instructores libres compartidos entre A y B.

# Lote 6 — lista de espera y avisos de apertura (075)

Estado: cuatro escenarios obligatorios OK, tipos de ambos proyectos OK. Manifiesto limpio hasta 075; rollback/reaplicación conserva notificaciones. Indicador `waitlist` implementado y apagado; sin push, llamadas remotas ni correos reales. No se ejecutaron componentes, lint ni build.

Marca A/B en `users.enrollment_waitlist`, con fecha y preferencia estructurada opcional. No se crea tabla ni módulo paralelo. La notificación utiliza el outbox existente de `notifications`, su lease, tres intentos y correo. Evento único por persona + tipo + día de Guayaquil; orden de registro. La marca se retira solo tras entrega confirmada y si sigue siendo la misma inscripción de espera, identificada por un UUID de registro (no por reloj del cliente). Un nuevo registro no se borra al entregar un aviso antiguo.

Se comprueba apertura, cupo por intervalo y recursos reales de un plan completo antes de ofrecer el aviso. En habilitación/alta/extensión, el formulario existente consulta N: con N=0 continúa sin diálogo; N>0 pregunta si notificar y encola solo con esa decisión. El correo dice «sujeto a cupos disponibles» y no contiene nombre/código de cohorte ni concede reservas. No se promete entrega al encolar.

Alumnos incorpora filtro por tipo interesado, contadores y reintento auditado de avisos fallidos. El filtro se aplica antes de paginar en el listado existente. El alumno ve «Avísame cuando abra» y WhatsApp secundario solo si existe número configurado en el contenido actual. No se modificaron números ni datos de contacto.

Archivos: 075 y tres scripts operativos, modelos/RPC, rutas existentes de horario/cohortes/Alumnos, servicio de correo/notificaciones y componentes de las mismas pantallas. Catálogo de errores y pruebas pendientes actualizados.

## Evidencia real

`tests/concurrency/cohortesLote6.ts` usa PostgreSQL embebido efímero:

1. N=0 sin oferta ni cola.
2. Dos interesados, filtro A/B antes de paginar, un correo por persona/tipo/día; repetir evento no duplica y no retira marcas.
3. Fallos hasta agotar tres intentos: marca conservada, alerta al administrador con permiso, reintento auditado, recuperación y retirada solo de la marca entregada; resolución automática de alerta.
4. Rollback → reaplicación, con notificaciones conservadas.

No se enviaron mensajes SMTP ni se ejecutó la exploración de navegador descrita abajo.

## Guion de despliegue y rollback

1. Respaldar/restaurar una copia de usuarios, notificaciones, permisos, cohortes, matrículas/reservas y auditoría. Guardar conteos y estados de email/leases; no publicar exportaciones con datos personales.
2. Ensayar en copia: preflight 075 → 075 → verificación → escenarios de fallo/entrega → apagar indicadores → rollback 075 → reaplicar → verificación. Comparar usuarios/notificaciones y comprobar que las marcas solo cambian por registro, retiro explícito o entrega.
3. Aplicar 075 manualmente después de 074. Los 14 indicadores quedan apagados. Desplegar el código compatible con el tipo de notificación nuevo; conservarlo durante un rollback con historia de esos avisos.
4. Activar solo después del cierre: precios y vehículos configurados, reglas de fechas/capacidad/reservas operativas, permisos explícitos y proceso de correos existente activo. No existe carga automática de precios ni administradores. El preflight de históricos y sus exportaciones siguen siendo obligatorios antes de activar el conjunto.
5. Verificar ACL, índice de deduplicación, conteos, filtros, reintentos y cierre de alertas. Un mensaje en cola no cuenta como enviado. Los trabajos con DISABLE_CRON no entregarán estos correos.
6. Rollback: resolver primero emails pendientes; el script se niega a borrarlos. Apagar indicadores, revertir lotes posteriores y aplicar rollback 075. Conserva marcas, columnas y notificaciones/historia; restaura el listado anterior. Código en rama apagada evita llamar RPC retiradas. Reaplicación probada con datos sintéticos conservados.

## Guía QA manual

Preparar copia local: alumno(s) ficticios con matrícula A/B, admin con `manage_cohorts_prices`, instructor activo, un vehículo y cohorte abierta que contenga un plan de 10 horas. Proveedor de correo exclusivamente de pruebas/local. Restaurar fixture completo entre escenarios; no ejecutar estas alteraciones en producción.

| Pasos y datos | Resultado esperado | Restablecimiento |
| --- | --- | --- |
| Alumno sin horario pulsa Avísame | Registra tipo/fecha del servidor y preferencia estructurada; segunda pulsación conserva registro | Retiro explícito en copia o recrear fixture |
| Cambiar tipo A/B | Cada marca es independiente; no mezcla inscripción/reserva/pago | Reponer fixture |
| Número de WhatsApp configurado/no configurado en copia | Enlace secundario solo con número válido; texto codificado, sin datos del alumno | Restaurar configuración local sin cambiar los contactos reales |
| Habilitar/extender con cero interesados | No aparece diálogo; no hay correos | Deshacer edición en copia |
| Dos interesados y recursos libres; habilitar/extender | Pregunta N correcto y tipo; cancelar conserva marcas, aceptar crea cola | Entregar correos de prueba o reponer copia |
| Todos los recursos ocupados, cierre pasado o cohorte deshabilitada | N=0; no se anuncia disponibilidad inexistente | Liberar fixture/restaurar período |
| Repetir aceptación el mismo día en dos sesiones | Un aviso por persona/tipo/día; no reserva recursos | Revisar índice y filas; restaurar copia |
| Ver filtro/contador A/B en Alumnos | Conteo y paginación coinciden; no crea otro listado | Quitar filtro |
| Provocar tres fallos en correo de pruebas | Marca conservada; alerta ESPERA_CORREO_FALLIDO sin spam, solo permiso de cohortes | Corregir proveedor local; reintentar con motivo en Alumnos |
| Reintentar tras corregir y entregar | Misma notificación, sin duplicar evento; retira marca entregada y cierra alerta automáticamente | Recrear copia |
| Registrar de nuevo antes de entregar un aviso antiguo | El registro nuevo no se elimina por la entrega anterior | Recrear fixture |
| Cuenta inactiva o JWT de otro alumno intenta operar por id | ESPERA_CUENTA_NO_HABILITADA / pertenencia fijada por el sujeto autenticado; no escribe otro usuario | Restaurar cuenta ficticia |
| Tipo/preferencia inválidos, texto personal como preferencia o motivo vacío al reintentar | ESPERA_ENTRADA_INVALIDA; no guarda contenido arbitrario | Corregir campos |
| Indicador apagado o administrador sin permiso | ESPERA_REGLAS_INACTIVAS / PERMISO_REQUERIDO; no cola | Activar/conceder solo en copia |
| Fallo de consulta de oferta tras guardar cohorte | Mensaje explícito de que ya se guardó; permite consultar otra vez sin crear otra cohorte | Reintentar consulta o terminar sin avisar |

Alertas: ESPERA_CORREO_FALLIDO (alta), destinatarios con `manage_cohorts_prices`, clave usuario/código/notificación, enfriamiento de un día y cierre tras entrega. La observación de leases atascadas/latido general se consolida en lote 11; no se presenta como operativa todavía.

Riesgos pendientes: proveedor real de correo/configuración y QA visual. No hay garantía de cupo al recibir el aviso. Conciliación de Kushki continúa PENDIENTE según lote 3. Catálogo: `cohortes-errores.md`; automatización visual diferida en `PRUEBAS_PENDIENTES.md`.
