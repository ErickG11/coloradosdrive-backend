-- SOLO LECTURA. Revisar antes de aplicar 032 en SQL Editor.
begin read only;

select to_regprocedure('private.eligible_free_slots_for_enrollment(uuid,uuid)') as helper_e1,
  to_regprocedure('private.eligible_practice_slot_changes(uuid)') as helper_e2,
  to_regprocedure('public.swap_practice_slot(uuid,uuid,uuid)') as cambio_e2,
  to_regprocedure('public.released_practice_slots_for_student(uuid)') as listado_e2;

-- Filas historicas que hoy permiten que una franja libre vuelva a ofrecerse
-- al mismo alumno. Incluye origen alumno y cambio_cupo, todos los resultados.
select c.origen, c.resultado, count(*) as franjas_soltadas_aun_libres
from public.practice_slot_cancellations c
join public.practice_slots s on s.id = c.slot_id
where s.student_id is null and s.status in ('disponible', 'liberado')
group by c.origen, c.resultado order by c.origen, c.resultado;

-- Caso manual reportado: historial y estado actual de la franja.
select c.slot_id, c.student_id, c.origen, c.resultado,
  c.consumio_reprogramacion, s.status, s.student_id as ocupante_actual
from public.practice_slot_cancellations c
left join public.practice_slots s on s.id = c.slot_id
where c.slot_id = '77d0863f-0108-4e2a-9ea4-e4ca616d87c1'::uuid
order by c.cancelled_at;

select has_function_privilege('service_role', 'private.eligible_free_slots_for_enrollment(uuid,uuid)', 'execute') as helper_e1_permitido,
  has_function_privilege('service_role', 'private.eligible_practice_slot_changes(uuid)', 'execute') as helper_e2_permitido,
  has_function_privilege('service_role', 'public.swap_practice_slot(uuid,uuid,uuid)', 'execute') as cambio_permitido;
rollback;
