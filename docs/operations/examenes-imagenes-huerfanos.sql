-- SOLO LECTURA. No borrar storage.objects mediante SQL: usar Storage API/panel.
-- Revisar con backend detenido o sin subidas concurrentes. Una subida en curso
-- todavia puede no tener referencia SQL; no borrar automaticamente estos resultados.
begin read only;
select o.id,o.name as storage_path,o.created_at,o.updated_at
from storage.objects o left join public.questions q on q.image_path=o.name
where o.bucket_id='exam-question-images' and q.id is null
order by o.created_at;
select q.id question_id,q.exam_id,q.image_path as missing_storage_path
from public.questions q left join storage.objects o on o.bucket_id='exam-question-images' and o.name=q.image_path
where q.image_path is not null and o.id is null;
rollback;
