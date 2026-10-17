-- Solo lectura; no contiene nombres, cédulas ni correos.
select extname,extnamespace::regnamespace as schema from pg_extension where extname='btree_gist';
select count(*) as duraciones_invalidas from public.practice_slots where duration_minutes<>60;
select count(*) as solapamientos_alumno
from public.practice_slots a join public.practice_slots b on a.student_id=b.student_id and a.id<b.id
where a.student_id is not null and a.status in ('asignado','confirmado','completado')
  and b.status in ('asignado','confirmado','completado')
  and tsrange(a.scheduled_at at time zone 'UTC',(a.scheduled_at at time zone 'UTC')+interval '60 minutes','[)')
   && tsrange(b.scheduled_at at time zone 'UTC',(b.scheduled_at at time zone 'UTC')+interval '60 minutes','[)');
