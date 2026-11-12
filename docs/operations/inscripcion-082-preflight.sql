begin read only;
-- Exportable: incompatibilidades actuales, sin corregir ni activar reglas.
select a.student_id,a.id slot_a,b.id slot_b,a.scheduled_at,b.scheduled_at
from public.practice_slots a join public.practice_slots b on a.student_id=b.student_id and a.id<b.id
where a.status in('asignado','confirmado','completado') and b.status in('asignado','confirmado','completado')
and a.scheduled_at<b.scheduled_at+interval '1 hour' and b.scheduled_at<a.scheduled_at+interval '1 hour';
select id,practicas_hora_fin from public.app_settings;
rollback;
