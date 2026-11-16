# ADR 026 — La verificación de la cédula original queda solo a cargo del administrador

- Estado: aceptado. Cambio de requisito decidido por el dueño del proyecto el 14/11/2026.
- Fecha de este registro: 16/11/2026.
- Historia relacionada: CD-364 (agenda del instructor y asistencias por bloques).
- Base de datos: sin migración nueva (la última sigue siendo la 094).

## Contexto

Con el flujo de inscripción en línea (F19, migración 054) el instructor de la franja confirmaba en su pantalla que había visto la cédula original del alumno que venía de una solicitud (`PATCH /practice-slots/:id/identidad-presencial`, función SQL `confirmar_identidad_presencial`). La agenda del instructor marcaba además las franjas con identidad pendiente (`franjas_identidad_pendiente`).

La tesis define al instructor con acceso de solo lectura sobre sus franjas y avisos, más el registro de asistencia. La confirmación de identidad fue una ampliación posterior. Al rediseñar la agenda del instructor (CD-364) se decidió que esa responsabilidad no corresponde al instructor.

## Decisión

- La verificación de identidad la hace únicamente el administrador, con la ruta que ya existía: `POST /students/:id/identidad-presencial` (función SQL `confirmar_identidad_presencial_admin`, migración 056).
- Se elimina del backend la ruta del instructor y la marca `identidadPresencialPendiente` / `certificadoOriginalRequerido` de `GET /practice-slots` para el rol instructor.
- En el frontend se retira el control del instructor y su llamada a la API (commit `df60272` de la rama de CD-364).
- No se tocan migraciones ni funciones SQL: `confirmar_identidad_presencial` y `franjas_identidad_pendiente` quedan en la base sin uso. Retirarlas exigiría una migración y se deja como mejora posterior.

## Consecuencias

- El instructor ya no puede confirmar identidad por ninguna vía HTTP: la ruta responde 404. Una prueba de integración lo comprueba (`tests/integration/practiceIdentityRemoved.test.ts`).
- **Decisión pendiente (producto y base de datos).** La función SQL del administrador (`confirmar_identidad_presencial_admin`, migración 056) está pensada como excepción auditada: exige un motivo de 10 a 300 caracteres y solo permite confirmar cuando ya venció la ventana del instructor, es decir, 48 horas después de terminar una franja confirmada o completada del alumno (error `IP410`). Con el instructor fuera del flujo, el administrador no puede verificar la cédula antes de la primera práctica ni sin esa espera. Para que el administrador verifique sin esa condición hace falta una migración 095 que la relaje. No se creó ni se aplicó: la decide el dueño. Mientras tanto, la verificación sigue disponible para el administrador solo después de la espera.
- El frontend anterior a esta integración aún muestra el control del instructor y recibiría 404. Por eso el backend y el frontend se fusionan seguidos (backend primero) y se despliegan juntos.
- Menos superficie de ataque: se reduce el número de rutas con permiso de escritura del instructor.

## Impacto sobre la tesis

La tesis describe al instructor con acceso de solo lectura y avisos. La confirmación de identidad por el instructor fue una ampliación posterior, gestionada por control de cambios. Este ADR revierte esa ampliación y deja al instructor en lo descrito por la tesis (consulta de su agenda, avisos y registro de asistencia). El documento de tesis no se modifica.

## Alternativas descartadas

- Mantener la ruta del instructor oculta en la interfaz: dejaría una acción de escritura accesible por API sin uso legítimo.
- Eliminar también las funciones SQL: requiere una migración que se aplica a mano sobre la base compartida; no justifica el riesgo antes de la defensa.

## Actualización

La decisión pendiente de la ventana de 48 horas se resuelve en el [ADR 027](027-identidad-admin-sin-ventana.md) con la migración 095.
