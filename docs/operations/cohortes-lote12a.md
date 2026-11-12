# Lote 12a — ajustes de contrato D1–D8 y D10

Implementación local, sin pruebas, lint ni build. Tipos e instalación completa se reservan para el final de todos los lotes autorizados.

081 incluye explícitamente el SQL de cierre L11 antes de sus cambios; no aplicar el artefacto L11 por separado además de 081. Se retira la unicidad global y se conserva la unicidad vigente por tipo y la excepción auditada para repetir. Los instructores son compartidos. Vehículos dejan de limitar y se retira su pantalla/ruta de configuración. No se crean horarios laborales ni bloqueos de disponibilidad.

Se introduce candado transaccional por alumno, control de prácticas de cualquier matrícula y holds propios, motivos de solape con curso/fecha/hora sin datos de cohorte. Tope horario en app_settings.practicas_hora_fin, por defecto 22; constructor TS/SQL e interfaces lo consumen.

SUPUESTO D6: inicio desde hoy si todas las franjas son futuras; se corrige el servicio que exigía mañana. Precio A=150/B=200, solo en script de datos explícito. D8 toma una instantánea de todos los administradores existentes al aplicar 081; no hay trigger de concesión para administradores futuros.

Los documentos físicos son informativos. El alumno con asignación ve los días hasta cierre (fin matrícula menos cinco días) si hay pendientes. La edición universal del checklist se completa en L12d, según el ajuste posterior.

Despliegue/rollback manual: respaldo primero; 001–080 según inventario, luego 081 (que incorpora L11). Mantener indicadores apagados. Preflight/verificación/rollback: inscripcion-081-*.sql. Reaplicación requiere volver al estado de cuerpos esperado por las guardas; nunca ignorarlas. El paquete final congela las guardas con normalización CR y documenta orden completo. Precios y permisos no crean cohortes ni datos de demostración.

QA manual de este lote, no ejecutada: desde panel crear cohortes propias y comprobar tarifa por tipo; con dos tipos del mismo alumno intentar horarios coincidentes; repetir hoy con una hora futura/pasada; cambiar el tope horario en la copia y comprobar que ninguna sesión termina después; comprobar que faltantes documentales no bloquean pagar y que el recordatorio desaparece al recibirlos. Restaurar la copia y apagar todos los indicadores.

Pendiente de cierre global: L12b, L12c, L12d, paquete final y los dos chequeos autorizados.
