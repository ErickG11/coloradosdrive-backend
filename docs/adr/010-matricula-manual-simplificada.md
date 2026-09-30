# ADR 010: Matrícula manual simplificada, confirmación única e integridad por tipo de curso

## Estado

Aceptado.

## Contexto

El wizard de matrícula manual creaba cuentas y matrículas en pasos
intermedios, permitía una sola matrícula por estudiante y cohorte, y no
distinguía entre los dos tipos de curso que ofrece la escuela (Tipo A,
motocicletas; Tipo B, vehículos livianos). Un estudiante puede cursar A y B, y
un reintento de red no debe crear cuentas duplicadas.

## Decisión

Los cambios de base de datos están en `migrations/020_matricula_manual_simplificada.sql`,
posterior a 018 y 019 (CD-05–07).

- **Confirmación única.** Los pasos Estudiante, Curso y Prácticas solo consultan
  o preparan; únicamente el resumen final crea cuenta nueva, matrícula y
  programación. El frontend consume el preview del backend y no mantiene un
  segundo algoritmo de calendario.
- **Una matrícula vigente por estudiante y tipo.** Vigentes: `activo` y
  `pendiente_cohorte`; terminales: `finalizado` y `retirado`. Un índice único
  parcial `(student_id, course_type)` lo impone en la base, incluso entre
  cursos o cohortes distintos del mismo tipo. Se permite A+B y reinscribirse
  tras un estado terminal. Se elimina la unicidad anterior estudiante/cohorte.
- **Catálogo explícito.** `manual_course_catalog` designa un `course_id` por
  tipo; nunca se elige "el primero" ni se interpreta por nombre. Sin
  designación, el tipo se muestra como no configurado. `course_id`,
  `course_type` y `practice_plan` se guardan también en matrículas pendientes
  de cohorte, que no habilitan prácticas ni exámenes.
- **Idempotencia.** Cada confirmación lleva una clave UUID ligada al
  administrador y a un hash canónico del payload: misma clave y payload
  recuperan la respuesta; mismo UUID con otro payload da 409. Perfil,
  matrícula, plan y franjas se escriben en una sola transacción PostgreSQL.
- **Auth, PostgreSQL y SMTP no son atómicos entre sí.** Ante un fallo solo se
  compensa una identidad nueva y conocida de esa operación, tras comprobar que
  el commit no ganó; una cuenta preexistente nunca se elimina ni se
  restablece. Si el resultado es incierto, la operación queda en revisión y se
  bloquea el reintento hasta reconciliar. El fallo de SMTP no revierte la
  matrícula; el reenvío es explícito y regenerar credenciales requiere
  confirmación.
- **Cuenta existente.** Reutiliza Auth y perfil; el correo indica usar las
  credenciales actuales y no contiene contraseña.
- **Calendario.** Semana = 5 días L–V o 2 días S–D, contando el primer día
  aplicable, en `America/Guayaquil`. Las horas por día multiplican bloques de
  60 minutos sin aumentar días. Un final manual genera solo los días
  aplicables del rango inclusivo, sin tarifa adicional.

## Seguridad

Las RPC nuevas solo ejecutan con `service_role`; los endpoints exigen
administrador. Las tablas nuevas tienen RLS y ningún permiso para `anon` ni
`authenticated`. La búsqueda de usuarios de Auth se encapsula en una función
privada con `search_path` vacío.

## Consecuencias

- Antes de aplicar la migración en otra base hay que inspeccionar matrículas
  vigentes duplicadas por tipo (impiden crear el índice) y pendientes sin
  curso conocido (abortan la migración; admite un mapa explícito por ID, que
  nunca debe inferirse).
- Siguen fuera de alcance: gestión de pendientes tras asignar cohorte, pantalla
  de reconciliación de operaciones inciertas, pagos, inscripción pública y
  certificados.
