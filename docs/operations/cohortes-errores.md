# Errores de cohortes e inscripción

SQL usa P7000 con el código estable en message y metadatos controlados en detail.
La API devuelve el código de dominio, estado HTTP y mensaje en español; nunca detalles
internos a alumnos. Autenticación/permiso/propiedad preceden a reglas de negocio.
No registrar nombre, correo, cédula, documentos, tokens ni tarjeta.

| Código | Causa | HTTP | Alumno | Administrador | Acción |
| --- | --- | --- | --- | --- | --- |
| PLAN_CONFIG_NO_DISPONIBLE | Configuración no disponible | 503 | No se pudo consultar el plan. Intenta nuevamente. | Verificar catálogo y permisos del backend | Restablecer configuración y reintentar |
| PLAN_ENTRADA_INVALIDA | Formato/modalidad/horas fuera de rango | 400 | Revisa la fecha, modalidad y horas de tu plan. | Deben ser 15 horas, 1–6 por día, 06:00–22:00 | Corregir campos |
| PLAN_INICIO_PASADO | Inicio anterior al día local | 409 | Elige una fecha de inicio desde hoy. | Inicio efectivo en el pasado | Elegir fecha vigente |
| PLAN_FRANJA_PASADA | Una franja ya comenzó | 409 | Esa hora ya pasó. Elige una hora posterior. | Deben ser futuras según reloj servidor | Recargar disponibilidad |
| COHORTE_FECHAS_INVALIDAS | Cadena de fechas incompatible | 422 | No se puede utilizar ese período de inscripción. | inicio matrícula ≤ fin matrícula ≤ fin curso; inicio curso ≤ fin curso | Ajustar fechas conjuntamente |

## Alertas

El lote 2 no crea workers ni alertas nuevas: no hay proceso periódico nuevo que pueda
atascarse. Las alertas operativas del contrato se integrarán en notificaciones/panel
existentes en los lotes que introduzcan sus causas. No se crea un módulo nuevo.
La guía de cada lote incluye cómo provocar sus errores y alertas.
