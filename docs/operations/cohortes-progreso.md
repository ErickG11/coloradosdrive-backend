# Progreso de cohortes e inscripción

Autorización: lotes 2–11 continuos; detener únicamente por las condiciones del documento del dueño.
Ramas: feat/cohortes-reglas-inscripcion en ambos repositorios. Sin push ni bases remotas.

| Lote | Estado | Evidencia / siguiente acción |
| --- | --- | --- |
| 1 | Aprobado y reaplicación verificada | 14 pruebas OK; 068 y 069 se revierten y reaplican sin borrar datos. |
| 2 | Completo | 16 casos TS/SQL y tipos OK; 12 combinaciones parametrizadas; interfaz detrás del indicador. |
| 3 | Completo; integración final pendiente en 11 | 10 escenarios nativos OK, tipos ambos OK, F45 001–072 sin errores; rollback/reaplicación OK. |
| 4 | Completo | 6 escenarios SQL OK, manifiesto limpio 073 y rollback/reaplicación OK; tipos ambos OK. |
| 5 | En preparación | Matrículas y acceso |
| 6 | Pendiente | Espera y avisos |
| 7 | Pendiente | Cambios y reasignaciones |
| 8 | Pendiente | Facturación cola/manual |
| 9 | Pendiente | Solicitudes, archivo y revocación |
| 10 | Pendiente | Documento por tipo/número |
| 11 | Pendiente | Integración, privacidad, permisos, errores/alertas y cierre |

Los 14 indicadores enabled=false por defecto y al cierre. implemented solo cambia al pasar su lote.
Precios y admins iniciales: plantillas sin valores reales. Vehículos: global no configurado hasta carga explícita.
Recuento real de instructores desconocido: prohibido consultar datos reales; no se usa un contador de fixtures.
Pruebas: solo obligatorias por lote y tipos; lint/build completos en 11.
