# ADR 007: Decisiones de diseño de horarios de práctica (RF-03)

## Estado

Aceptado.

## Contexto

RF-03 describe el flujo de confirmación de asistencia y liberación
dinámica de cupos con bastante detalle, pero deja varias decisiones de
implementación sin especificar literalmente: el mecanismo de asignación
inicial de una franja a un estudiante, qué pasa exactamente en los
bordes del estado (una franja que nunca se reclama, una asignada que
nunca se confirma), cómo se implementa "notificación en tiempo real", y
si el instructor puede escribir algo además de leer. Este ADR documenta
esas decisiones, tomadas junto con el usuario durante Sprint 4.

## Decisiones

### 1. Flujo de asignación: self-service con reclamo atómico

El documento solo dice "horario asignado al estudiante" como entrada
de RF-03, sin detallar el mecanismo. Se decidió: el admin crea la
franja sin estudiante (`student_id` NULL, status `disponible`); el
estudiante ve el calendario de franjas disponibles de su cohorte y
reclama una por sí mismo.

El reclamo usa un `UPDATE ... WHERE status IN ('disponible', 'liberado')`
en vez de comprobar el estado primero y actualizar después
(check-then-act). Si dos estudiantes reclaman la misma franja casi al
mismo tiempo, solo el primero encuentra una fila que matchea; el
segundo no actualiza nada y recibe 409. Un check-then-act tendría una
ventana donde ambas peticiones leen "disponible" antes de que
cualquiera escriba, y ambas terminarían reclamando la misma franja.

### 2. Reset de campos al liberar y al reclamar de nuevo

Al cancelar (asignado/confirmado → liberado): `student_id`,
`confirmed_at`, y `confirmation_notified_at` vuelven a `NULL`;
`release_notified_at` se pone en `now()`. Sin este reset, un segundo
estudiante que reclame la misma franja después nunca recibiría su
propia notificación de 20 minutos (el scheduler filtra por
`confirmation_notified_at IS NULL`, que ya estaría poblado del ciclo
anterior). Al reclamar de nuevo, no hace falta resetear
`release_notified_at` explícitamente en el reclamo mismo porque una
futura liberación lo vuelve a sobreescribir con `now()` de todas formas.

### 3. Extensión de "sin_practica" más allá de lo literal

El documento solo describe explícitamente la transición
liberado→sin_practica ("si ningún estudiante toma el cupo faltando 5
minutos"). Se decidió extender el mismo criterio a `disponible` (una
franja que nunca se reclamó) y a `asignado` (un estudiante la reclamó
pero nunca confirmó): ninguno de los 3 casos tiene un estudiante que
vaya a presentarse, y a 5 minutos del inicio no hay margen real para
que alguien más la tome. El instructor se notifica igual en los 3
casos - consistente con la regla general del documento ("el instructor
recibe notificación únicamente si ningún estudiante confirmó asistencia
en la ventana definida"), que no distingue por qué llegó a ese punto.

### 4. confirmado → completado: automatizado por el scheduler

No especificado en la tarea original del scheduler (que solo mencionaba
notificar a los 20 min y cerrar a los 5 min). Se agregó como tercera
responsabilidad: sin ella, `completado` nunca se habría usado. Se
marca cuando `scheduled_at + duration_minutes` ya pasó sobre una franja
`confirmado`. Sin notificación asociada - el documento no la pide.

### 5. Alcance agregado: el instructor registra asistencia

El documento de tesis dice que el instructor tiene "acceso de solo
lectura a su disponibilidad semanal y a los estudiantes asignados".
Durante este sprint se decidió agregar `PATCH
/practice-slots/:id/attendance`, para que el instructor registre si el
estudiante asistió (`attended`, boolean nullable, solo sobre franjas
propias ya `completado`). **Este es un cambio de alcance consciente**,
no una desviación accidental - el documento de tesis se actualiza por
separado para reflejarlo, fuera de este sprint de código.

### 6. Notificaciones en tiempo real: Broadcast, no `postgres_changes`

Este proyecto no usa Row Level Security en ninguna tabla -
`supabaseAdmin` (el único cliente que escribe en todo el backend) la
ignora por diseño (`SupabaseClient` con `service_role`). Suscribirse a
`postgres_changes` sobre `practice_slots` sin RLS transmitiría a
cualquier suscriptor los cambios de cualquier fila - de cualquier
cohorte, de cualquier estudiante - porque `postgres_changes` no filtra
por quién debería poder ver qué, solo por la tabla completa. Con
Broadcast, el backend decide explícitamente qué payload ya sanitizado
envía y a qué canal, consistente con ADR 001 ("el frontend nunca accede
directo a la base de datos").

Se usa `channel.httpSend()` (REST) en vez de `channel.send()` +
`subscribe()` (WebSocket): no hace falta mantener una conexión
suscrita para un envío puntual y ocasional, más simple y sin el
overhead del handshake de suscripción - encaja mejor con el límite de
latencia de RNF-05 (≤5s).

**Convención de canales**: `cohort-{cohortId}-practice-slots` para
notificaciones dirigidas a toda una cohorte (liberación de cupo, evento
`slot-released`); `user-{userId}-practice-slots` para notificaciones
personales (recordatorio de confirmación al estudiante, evento
`confirmation-requested`; aviso de sin-práctica al instructor, evento
`no-practice`). No especificado por el usuario, elección técnica
delegada explícitamente.

### 7. node-cron 3.x, no 4.x

`node-cron@4` requiere Node ≥20; este proyecto está fijado a Node 18
LTS (`engines` en `package.json`, ver ADR 003 sobre por qué Node 18 es
el runtime mandado). Se usa `node-cron@^3.0.3`, compatible con Node
≥6, con su paquete de tipos correspondiente (`@types/node-cron@3`, no
compatible con la API de la v4).

## Consecuencias

**Positivas**

- El reclamo atómico y los resets de campos previenen exactamente las
  dos clases de bugs más probables en este dominio: dos estudiantes
  "ganando" la misma franja, y un estudiante nuevo heredando el ciclo
  de notificación de quien canceló antes que él.
- Broadcast evita depender de RLS, que este proyecto nunca adoptó -
  ninguna migración futura necesita agregar políticas de RLS solo para
  que esta función sea segura.

**Negativas / trade-offs asumidos**

- El self-service de reclamo y los 3 puntos de extensión de
  `sin_practica` son inferencias razonadas, no texto literal del
  documento - quedan documentados aquí para que una futura revisión del
  documento de tesis pueda confirmarlos o ajustarlos explícitamente.
- Sin RLS, toda la superficie de seguridad de esta función depende
  enteramente de que el backend nunca tenga un bug de autorización - no
  hay una segunda capa de defensa a nivel de base de datos. Se acepta
  este trade-off porque es el mismo modelo de seguridad que ya rige
  todo el resto del proyecto desde Sprint 1, no una excepción nueva.
- El scheduler corre en el mismo proceso que el servidor HTTP: un
  reinicio del proceso (deploy, caída) detiene ambos a la vez. No hay
  un mecanismo de "recuperar notificaciones perdidas" más allá de que
  la próxima corrida (al minuto siguiente) vuelva a evaluar el estado
  real de cada franja - aceptable dado que las condiciones de las 3
  fases se basan en el estado actual de la fila, no en un registro de
  "qué corrida ya la procesó".

## Alternativas descartadas

- **Asignación de franjas por el admin** (en vez de self-service): más
  cercano a "horario asignado al estudiante" leído literalmente, pero
  el documento también dice que el estudiante "confirma / no asiste" -
  un flujo puramente admin-asignado no explica por qué el estudiante
  necesitaría ver un calendario de franjas _disponibles_ en absoluto.
  Self-service es la lectura más consistente con el resto del RF.
- **`postgres_changes` con RLS nueva**: hubiera requerido introducir
  RLS por primera vez en el proyecto, solo para esta función - cambio
  de arquitectura de seguridad demasiado grande para lo que pide RF-03.
