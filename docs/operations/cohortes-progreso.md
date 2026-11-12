# Progreso de cohortes e inscripción

Autorización: lotes 2–11 continuos; detener únicamente por las condiciones del documento del dueño.
Ramas: feat/cohortes-reglas-inscripcion en ambos repositorios. Sin push ni bases remotas.

| Lote | Estado | Evidencia / siguiente acción |
| --- | --- | --- |
| 1 | Aprobado y reaplicación verificada | 14 pruebas OK; 068 y 069 se revierten y reaplican sin borrar datos. |
| 2 | Completo | 16 casos TS/SQL y tipos OK; 12 combinaciones parametrizadas; interfaz detrás del indicador. |
| 3 | Completo; integración final pendiente en 11 | 10 escenarios nativos OK, tipos ambos OK, F45 001–072 sin errores; rollback/reaplicación OK. |
| 4 | Completo | 6 escenarios SQL OK, manifiesto limpio 073 y rollback/reaplicación OK; tipos ambos OK. |
| 5 | Completo | 6 escenarios nativos OK, tipos ambos OK, instalación y rollback/reaplicación 074 OK. |
| 6 | Completo | 4 escenarios SQL OK, tipos ambos OK; instalación limpia 075, recuperación de correo y rollback/reaplicación OK. |
| 7 | Completo | 5 escenarios SQL OK, calendario y guard de pago incluidos; tipos ambos OK; rollback/reaplicación 076–077 OK. |
| 8 | Completo | 4 escenarios locales OK: único, fallo aislado, reintento, rollback/reaplicación; tipos ambos OK; proveedor fiscal pendiente. |
| 9 | Completo | 4 escenarios nativos OK, dos revisores reales, aprobación/archivo, ambas revocaciones, retención heredada, rollback/reaplicación; tipos ambos OK. |
| 10 | Completo | 2 escenarios locales agrupados OK: pares tipados, solicitud/aprobación real y representante, backfill trazable, rollback/reaplicación; tipos ambos OK. |
| 11 | Pendiente | Integración, privacidad, permisos, errores/alertas y cierre |

Los 14 indicadores enabled=false por defecto y al cierre. implemented solo cambia al pasar su lote.
Precios y admins iniciales: plantillas sin valores reales. Vehículos: global no configurado hasta carga explícita.
Recuento real de instructores desconocido: prohibido consultar datos reales; no se usa un contador de fixtures.
Pruebas: solo obligatorias por lote y tipos; lint/build completos en 11.

## Integración pendiente (lote 11, antes de activar)

- Conectar matrícula manual/caja y su última sesión parcial al constructor único de 15 horas; usar precio por tipo cuando los indicadores nuevos estén activos.
- Revisar horizonte del calendario contra todas las fechas candidatas y mostrar precio antes de reservar.
- Auditar todas las rutas heredadas de acceso y eliminar nombres/códigos de cohorte de respuestas de alumno.
- Aplicar permisos separados a rutas heredadas, dependencias de activación, observación de leases/latidos y las alertas restantes; no afirmar que estén operativas todavía.
- Ejecutar catálogo consistente, checks finales, lint/build y guías QA consolidadas; mantener todos los indicadores apagados.
