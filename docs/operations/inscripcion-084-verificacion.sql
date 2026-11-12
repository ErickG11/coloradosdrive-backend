begin read only;
select to_regprocedure('public.set_enrollment_document_v12(uuid,uuid,uuid,text,text,text)'),to_regprocedure('public.transfer_enrollment_cohort_v12(uuid,uuid,uuid,uuid,timestamp with time zone,text,boolean)');
rollback;
