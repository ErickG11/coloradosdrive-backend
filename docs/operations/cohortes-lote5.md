# Lote 5 — matrícula por tipo y acceso individual (074)

Estado: implementación local, seis escenarios obligatorios y tipos de ambos proyectos OK. No hay push ni activación. El manifiesto instala limpio hasta 074 y excluye 064. No se ejecutaron lint, build ni pruebas de componentes.

## Cambios

074 añade el estado Anulada, mantiene historia y añade extensión individual de acceso con motivo/auditoría. La restricción vigente se aplica por alumno y tipo; A y B conviven. Finalizado bloquea por defecto volver a matricularse en el mismo tipo. La RPC de excepción conserva la fila finalizada y registra una nueva matrícula sin cohorte, con actor/motivo. Retirada y Anulada no ocupan la unicidad vigente. No hay sobrecupo ni borrado de historia.

El índice global heredado se conserva al desplegar con indicadores apagados. Un trigger de configuración lo sustituye al activar `enrollment_access`; al desactivar exige que no queden A y B vigentes para el mismo alumno antes de restituir el guard global. La operación no anula ni borra datos para poder desactivar.

El acceso nuevo se calcula desde la matrícula activa/finalizada, su etapa pagada y sus fechas propias: inicio inclusivo a 00:00 local y fin de acceso exclusivo a 00:00 del día siguiente. La cohorte deshabilitada no lo quita. Los históricos con `individual_dates_guard_ready=false` conservan su criterio anterior hasta una excepción con evidencia: no se les inventan fechas. Contenido sigue exigiendo sus reglas particulares de publicación, ventanas, intentos y permisos.

Se elimina el bloqueo cruzado de contenido A por inscripción B incompleta. La API de prácticas limita sus cohortes a las matrículas que permiten acceso; contenido valida además su curso exacto en SQL. El alumno puede seleccionar la inscripción A/B para retomar su propia reserva/pago. El estado «pago en proceso» sobrevive al plazo original. La ficha de Alumnos incorpora fechas individuales, extensión y excepción de repetición dentro de sus secciones existentes.

Archivos: migración y scripts 074; modelos `individualEnrollmentAccess`, contratos de Anulada, helpers de alcance/acceso, servicio de estado, rutas existentes de estudiante/Alumnos y sus componentes. El catálogo de errores se amplía por cada rechazo nuevo.

## Evidencia automática

`tests/concurrency/cohortesLote5.ts`, PostgreSQL local real: seis casos OK.

1. Dos conexiones independientes por el mismo alumno/tipo: solo una matrícula.
2. A y B conviven.
3. Acceso por fechas aunque se deshabilite la cohorte; 23:59:59 permitido, siguiente medianoche rechazado, aunque B siga incompleta.
4. RPC directa sin permiso rechazada, incluido `SET ROLE authenticated`; extensión autorizada restaura acceso y audita.
5. Curso finalizado bloquea repetición hasta excepción auditada; Anulada libera el tipo.
6. Desactivar bloquea si quedan A/B vigentes; al resolver el fixture, rollback → reaplicación conserva estados, fechas y filas.

## Guion de despliegue manual

1. Respaldar y restaurar una copia con matrículas, permisos, auditoría, estados y relaciones de prácticas/reservas/pagos. Guardar conteos por alumno/tipo/estado y hashes de datos autorizados para comparación.
2. En copia ejecutar preflight 074 y exportar duplicados por tipo, históricos sin fechas y evidencia de `private.lote1_preflight_cases`. No se consultó ningún caso real en esta tarea. Resolver únicamente mediante decisión auditada del operador.
3. Aplicar 074 después de 073 y ejecutar verificación. El archivo confirma separadamente el nuevo valor enum antes de usarlo; no envolver el archivo completo en una transacción externa. Mantener todos los indicadores apagados; el guard global sigue instalado.
4. Ensayar activación solamente en la copia: activar el indicador con las dependencias del flujo listas. El cambio de índice y del indicador es una transacción. Revisar A/B y acceso de alumnos con fechas/históricos.
5. Verificar conteos, importes, relaciones y ausencia de cambios en pagos/prácticas. La extensión afecta solo acceso, no fin de prácticas, cupo, precio ni factura.
6. Rollback funcional: revertir lotes posteriores; resolver primero casos de convivencia A/B con una decisión del operador, sin borrado automático. Apagar indicadores y ejecutar rollback 074. Se conserva el enum Anulada y las columnas/auditoría, porque retirarlos exigiría reescritura o pérdida de datos. Mantener código compatible con Anulada; la rama apagada evita llamar las RPC nuevas retiradas. Reaplicar 074 y verificación: ensayado localmente, conservando datos.

## Guía QA manual y restablecimiento

Usar solo la copia local con cursos A/B, alumno ficticio y admin con `manage_cohorts_prices`. Abrir dos sesiones de navegador. Configurar fechas dentro del período de práctica de la matrícula y reloj local controlado. Cada caso restaura el fixture completo o revierte mediante operación auditada en esa copia.

| Datos y pasos | Resultado esperado | Restablecimiento |
| --- | --- | --- |
| Dos pestañas crean el mismo tipo | Una gana; MATRÍCULA_TIPO_VIGENTE en la otra (código `MATRICULA_TIPO_VIGENTE`) | Conservar la ganadora o recrear copia |
| Inscripción A pagada con acceso hoy y B sin pagar | A puede usar su contenido; B retoma su horario/reserva propios mediante selector | Reponer fixtures |
| Cambiar de A a B con consulta de reserva lenta | Nunca muestra ni permite pagar una reserva A como si fuera B | Recargar ambas inscripciones |
| Deshabilitar la cohorte de A | Conserva acceso de A durante sus fechas | Habilitar con motivo solo si corresponde |
| Reloj al comienzo, último segundo y medianoche siguiente | Acceso según fechas individuales; contenido mantiene sus restricciones | Restaurar reloj efímero |
| Histórico sin fechas demostrables | Se muestra pendiente de evidencia y conserva el guard anterior | No inferir fechas; aprobar excepción por procedimiento 069 |
| En ficha Alumnos, extender fin de acceso con motivo | Nueva fecha visible y auditoría; prácticas/cupo/importe intactos | Restaurar fecha solo recreando fixture; no simular reducción como extensión |
| Motivo vacío, fin anterior, matrícula no activa o sin evidencia | MATRÍCULA_EXTENSION_INVALIDA / MATRÍCULA_ACCESO_ESTADO_INVALIDO (`MATRICULA_*`) | Corregir datos |
| Repetir un tipo finalizado desde flujo común | MATRÍCULA_REPETICION_REQUIERE_EXCEPCION | Usar acción administrativa explícita con motivo |
| Autorizar repetición en ficha | Conserva la finalizada; crea pendiente sin cohorte y audita excepción | Reponer fixture |
| Pedir excepción sin finalizada | MATRÍCULA_REPETICION_ESTADO_INVALIDO | Seleccionar caso válido |
| Cuenta no activa, id ajeno/inexistente o RPC con JWT sin permiso | MATRÍCULA_CUENTA_NO_HABILITADA, MATRÍCULA_AJENA, MATRÍCULA_NO_ENCONTRADA o PERMISO_REQUERIDO; sin mutación | Restaurar permiso/cuenta solo en copia |
| RPC nueva con indicador apagado | MATRÍCULA_REGLAS_INACTIVAS; flujo heredado disponible | Activar solo para QA local |
| Intentar apagar indicador con A/B vigentes | MATRÍCULA_ROLLBACK_CONVIVENCIA; transacción conserva el indicador y matrículas | Decidir y resolver los casos en copia; no forzar ni borrar |

Los códigos escritos con tilde en la explicación se transportan sin tilde como `MATRICULA_*`. No se añaden alertas periódicas nuevas en este lote: backfill/denegaciones se consolidan en 11. La automatización de interfaz queda diferida, con esta guía obligatoria. Riesgos pendientes hasta integración: revisar todas las rutas heredadas de acceso/privacidad y el cierre de la matrícula manual antes de activar.
