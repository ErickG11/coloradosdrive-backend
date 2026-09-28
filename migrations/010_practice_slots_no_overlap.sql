-- 010_practice_slots_no_overlap.sql
-- Cierra un hueco real que se vuelve explotable con el generador en bloque
-- de matriculación manual: sin este índice, dos matriculaciones concurrentes
-- podrían asignar al mismo instructor dos franjas en el mismo scheduled_at.
--
-- Antes de aplicar: verificar que no haya datos existentes que violen esto.
-- No se puede correr esta verificación desde aquí (sin conexión SQL directa
-- al proyecto real) — correr en el SQL Editor de Supabase antes de aplicar
-- esta migración:
--
--   select instructor_id, scheduled_at, count(*)
--   from practice_slots
--   where status in ('disponible', 'asignado', 'confirmado')
--   group by instructor_id, scheduled_at
--   having count(*) > 1;
--
-- Si esa consulta devuelve filas, hay que resolver el choque a mano
-- (reprogramar o liberar una de las franjas) antes de que este CREATE
-- UNIQUE INDEX pueda aplicarse — Postgres rechaza el índice si encuentra un
-- duplicado existente.

create unique index practice_slots_instructor_no_overlap
  on practice_slots (instructor_id, scheduled_at)
  where status in ('disponible', 'asignado', 'confirmado');

comment on index practice_slots_instructor_no_overlap is
  'Un instructor no puede tener dos franjas activas (disponible/asignado/confirmado) en el mismo scheduled_at. liberado/sin_practica/completado quedan fuera a propósito: son estados históricos que no deben bloquear reutilizar ese instructor+hora en el futuro.';
