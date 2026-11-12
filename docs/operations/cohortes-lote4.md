# Lote 4 — administración de cohortes y configuración (073)

Cambios: `073_cohortes_administracion.sql`, sus tres scripts operativos, tipos, servicio/controlador/rutas existentes de cohortes y formulario existente. No hay módulo nuevo. Indicador `cohort_admin` implementado y apagado; no se activó ningún flujo ni se publicaron ramas.

El nombre es único globalmente por comparación de minúsculas, espacios exteriores y descomposición Unicode sin acentos. Un bloqueo de nombres serializa altas/ediciones. El error administrativo identifica el nombre que ya existe. Código autogenerado; inicio, curso y código se conservan cuando hay matrículas o reservas. La cadena de fechas se valida en SQL. Un fin más corto respeta el máximo fin individual; las reservas en pago siguen contando después de vencer su plazo original. Terminar el curso lo vuelve de solo lectura. Reducir cupo usa máximo por intervalos. Cada alta/edición se audita con actor, anterior, nuevo y motivo. Extender no envía correos.

El precio por tipo se cambia en una RPC con permiso específico y auditoría; la primera carga exige el script revisable de datos y no se admite desde esa RPC ni desde 064. Vehículos globales: RPC bajo el mismo bloqueo de prácticas, conserva lo agendado, informa las horas sobre el límite y emite notificación administrativa por permiso. El campo de vehículos por cohorte sigue siendo informativo.

## Resultados reales

`tests/concurrency/cohortesLote4.ts`: 6 escenarios obligatorios OK: nombre global normalizado incluso entre cursos distintos; inicio/código inmutables; acortamiento limitado por matrícula y por reserva en pago; cadena y tres estados derivados; terminado solo lectura; rollback/reaplicación conservando datos y auditoría. Instala el manifiesto limpio hasta 073 (incluye 066a/b, excluye 064). Tipos de ambos proyectos OK. No se ejecutaron pruebas de componentes, lint ni build. La guía manual siguiente no se presenta como ejecutada.

## Despliegue manual, ensayo y rollback

1. Respaldar y probar restauración en una copia: cohortes, matrículas, reservas/holds, precios, ajustes, permisos y auditoría. Guardar conteos y el SHA del código. Nunca exportar datos reales a Git.
2. En esa copia ejecutar `inscripcion-073-preflight.sql`. Exportar duplicados normalizados, cadenas de fechas incompatibles y `private.lote1_preflight_cases` a CSV protegido. La migración no renombra ni inventa fechas. Ningún caso real se consultó aquí; los casos exportables deben ser revisados por el operador antes de activar.
3. Ensayar 073 → verificación → rollback 073 → reaplicar 073 → verificación; comparar filas, precios e importes. El arnés local realizó este ciclo con fixtures.
4. Aplicar manualmente en Supabase después de 072; mantener apagados todos los indicadores. Los permisos de los dos administradores iniciales se cargan con la plantilla explícita aprobada, nunca automáticamente a todos. Confirmar precios A/B y flota global sin valores inventados.
5. Antes de activar: resolver duplicados y fechas incompatibles exportados; comprobar los casos históricos y la compatibilidad de matrícula manual que se cierra en 11. La aplicación de SQL no equivale a activar reglas.
6. Revertir lotes posteriores primero, apagar indicadores y ejecutar rollback 073. Restaura triggers anteriores y conserva auditoría, códigos y datos. No recalcula precios ni modifica reservas/pagos históricos. Revertir frontend/backend al código compatible anterior; reaplicación de 073 verificada localmente.

## Guía QA manual y errores/alertas

Datos: copia local del arnés con un admin ficticio con `manage_cohorts_prices`, curso A y B, una matrícula de fechas conocidas y una reserva en pago. Conceder ese permiso solo al admin de prueba. Establecer reloj local controlado; no cambiar reloj remoto. Restablecer cada caso reponiendo fixture o recreando la copia.

| Pasos en formulario/API local | Resultado esperado | Restablecimiento |
| --- | --- | --- |
| Crear «Cohorte Ágil»; intentar « COHORTE agil » en B | COHORTE_NOMBRE_DUPLICADO identifica el nombre existente; no segunda fila | Borrar solo la alta vacía del fixture con reglas apagadas o recrear copia |
| Editar inicio/curso/código tras asociar matrícula o reserva | COHORTE_INICIO_INMUTABLE / COHORTE_CODIGO_INMUTABLE; conservar datos | Reponer valores originales |
| Acortar por debajo del último fin de matrícula o reserva en pago | COHORTE_FIN_CON_COMPROMISOS; no modifica fechas | Reponer fixture |
| Bajar cupo por debajo del máximo ocupado en algún día | COHORTE_CUPO_INFERIOR | Conservar cupo previo |
| Fin de matrícula después del fin de curso; inicio posterior al fin | COHORTE_FECHAS_INVALIDAS; ajustar ambas fechas juntas | Corregir campos |
| Extender solo fin de curso con matrícula cerrada | Ayuda «¿extender también la matrícula?»; no reabre ni envía correo | Deshacer extensión solo en copia |
| Avanzar al día siguiente del fin y editar cualquier campo | COHORTE_TERMINADA; controles de edición solo lectura | Recrear fixture de período abierto |
| Deshabilitar con alumno pagado | Cierra futuras inscripciones; datos/acceso individual se conservan | Habilitar con motivo |
| Dos pestañas editan la misma versión | COHORTE_VERSION_CONFLICTO en la segunda; ofrece recarga | Recargar versión actual |
| Curso o id inexistente, campo no permitido, motivo vacío | COHORTE_CURSO_NO_ENCONTRADO / COHORTE_NO_ENCONTRADA / COHORTE_ENTRADA_INVALIDA | Corregir payload |
| Revocar permiso y guardar; después invocar RPC con JWT authenticated | PERMISO_REQUERIDO / rechazo ACL, sin mutación | Restituir permiso solo al admin fixture |
| Precio inicial ausente; intentar cargar desde botón | PAGO_PRECIO_CARGA_INICIAL; solo plantilla revisada permite carga inicial | Cargar precio sintético mediante script explícito en copia |
| Precio negativo/no entero en centavos o motivo vacío | PAGO_PRECIO_INVALIDO | Corregir importe y motivo |
| Cambiar precio con reserva en curso | Reserva y pago conservan precio fijado; auditoría del precio nuevo | Restaurar catálogo mediante cambio auditado |
| Bajar vehículos con más prácticas simultáneas | Conserva prácticas, cuenta horas sobre límite, alerta CAPACIDAD_HORAS_SOBRE_LIMITE solo para permiso de cohortes; nuevas reservas en esas horas no pasan | Subir flota o reasignar en copia; aviso se cierra al resolver mediante configuración |
| Vehículos negativos/fraccionarios o motivo vacío | CAPACIDAD_ENTRADA_INVALIDA | Corregir entrada |
| Invocar operación nueva con indicador apagado | COHORTE_REGLAS_INACTIVAS; formulario heredado permanece | Activar únicamente en copia de QA |
| Cancelar con matrículas activas | COHORTE_CANCELACION_BLOQUEADA; flujo de reasignación se entrega en 7 | No cancelar; reponer fixture |

Validar foco, mensajes, teclado, motivo, recarga de versión, precio informativo y configuración global en escritorio/móvil. No existe automatización de componentes en este lote; se registra en `PRUEBAS_PENDIENTES.md`. Riesgo pendiente hasta integración: cerrar compatibilidad de matrícula manual, vistas de alumno y permisos de rutas heredadas antes de activar.
