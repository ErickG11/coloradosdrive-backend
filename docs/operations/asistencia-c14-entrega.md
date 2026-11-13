# Entrega C14 — commits, archivos y guardas

Base backend `d1525ac`; base frontend `8ade586`. Rama `feat/cohortes-reglas-inscripcion`. Sin push.

[Operación y aplicación](asistencia-c14-operacion.md) · [Aceptación y límites](asistencia-c14-aceptacion.md) · [ADR 024](../adr/024-asistencia-por-bloques.md).

## Archivos por commit

### A — `68a3f77` · coloradosdrive-backend

- `docs/operations/cohortes-manifiesto-despliegue.json`
- `docs/operations/inscripcion-088-guardas.json`
- `docs/operations/inscripcion-088-preflight.sql`
- `docs/operations/inscripcion-088-rollback.sql`
- `docs/operations/inscripcion-088-verificacion.sql`
- `migrations/088_contrato_asistencia.sql`
- `tests/helpers/migrationManifest.ts`

### B — `53bc27c` · coloradosdrive-backend

- `docs/operations/cohortes-manifiesto-despliegue.json`
- `docs/operations/inscripcion-089-guardas.json`
- `docs/operations/inscripcion-089-preflight.sql`
- `docs/operations/inscripcion-089-rollback.sql`
- `docs/operations/inscripcion-089-verificacion.sql`
- `migrations/089_asistencia_bloques.sql`
- `tests/helpers/migrationManifest.ts`

### C — `21482af` · coloradosdrive-backend

- `docs/operations/cohortes-manifiesto-despliegue.json`
- `docs/operations/inscripcion-090-guardas.json`
- `docs/operations/inscripcion-090-preflight.sql`
- `docs/operations/inscripcion-090-rollback.sql`
- `docs/operations/inscripcion-090-verificacion.sql`
- `migrations/090_reposicion_bloques.sql`
- `tests/helpers/migrationManifest.ts`

### D — `6a16361` · coloradosdrive-backend

- `docs/operations/cohortes-manifiesto-despliegue.json`
- `docs/operations/inscripcion-088-guardas.json`
- `docs/operations/inscripcion-088-rollback.sql`
- `docs/operations/inscripcion-089-rollback.sql`
- `docs/operations/inscripcion-090-rollback.sql`
- `docs/operations/inscripcion-091-guardas.json`
- `docs/operations/inscripcion-091-preflight.sql`
- `docs/operations/inscripcion-091-rollback.sql`
- `docs/operations/inscripcion-091-verificacion.sql`
- `migrations/088_contrato_asistencia.sql`
- `migrations/091_avisos_bloques.sql`
- `src/config/database.types.ts`
- `src/controllers/practiceBlock.controller.ts`
- `src/models/notification.model.ts`
- `src/models/practiceBlock.model.ts`
- `src/routes/practiceBlock.routes.ts`
- `src/routes/practiceSlot.routes.ts`
- `src/services/practiceSlotNotification.service.ts`
- `src/services/realtime.service.ts`
- `tests/helpers/migrationManifest.ts`

### E — `b8a8f3f` · coloradosdrive-frontend

- `app/(student)/student/schedule/BlockDialogs.tsx`
- `app/(student)/student/schedule/blockFormat.ts`
- `app/(student)/student/schedule/blocks.module.css`
- `app/(student)/student/schedule/page.tsx`
- `components/layout/DashboardShell.tsx`
- `components/layout/Sidebar.tsx`
- `components/notifications/NotificationBell.tsx`
- `components/practice-blocks/PracticeBlockProvider.tsx`
- `hooks/useNotifications.ts`
- `types/notification.ts`
- `types/practiceBlock.ts`

### F — `d8d82d4` · coloradosdrive-frontend

- `app/(admin)/admin/page.tsx`
- `app/(admin)/admin/students/StudentAbsences.tsx`
- `app/(admin)/admin/students/StudentDetail.tsx`
- `app/(admin)/admin/students/StudentTable.tsx`
- `app/(instructor)/instructor/page.tsx`
- `app/(student)/student/schedule/page.tsx`
- `components/admin-dashboard/RecentPracticeAbsences.tsx`
- `components/layout/DashboardShell.tsx`
- `components/practice-blocks/PracticeBlockProvider.tsx`
- `hooks/useNotifications.ts`
- `hooks/usePracticeAbsences.ts`
- `types/practiceBlock.ts`

### G — documentación de esta entrega

- `docs/adr/024-asistencia-por-bloques.md`
- `docs/operations/asistencia-c14-operacion.md`
- `docs/operations/asistencia-c14-aceptacion.md`
- `docs/operations/asistencia-c14-entrega.md`
- `docs/operations/asistencia-e4.md`

Su identificador se obtiene con `git log -1` en backend; se evita una autorreferencia circular.

## Hashes congelados

Normalización: `md5(replace(prosrc,chr(13),''))`. Las dependencias con antes=después no se reemplazan en esa versión. Para funciones nuevas se admite ausencia o su cuerpo de salida conocido.

### 088

[Inventario JSON 088](inscripcion-088-guardas.json).

| Dependencia o reemplazo | Antes | Después |
|---|---|---|
| `private.reserve_schedule_v2(uuid,uuid,jsonb)` | `b6b2ee2afd0866b255ccaa9ef1fbd26c` | `b6b2ee2afd0866b255ccaa9ef1fbd26c` |
| `private.confirm_payment_v2(uuid,text,text,text,bigint,text,text,text)` | `6fbf8dea16054980095bd760988b2baf` | `6fbf8dea16054980095bd760988b2baf` |
| `private.confirm_plan_change_v2(uuid,uuid,uuid)` | `7367c7611d0c2eba97f64f2d8aa422c6` | `7367c7611d0c2eba97f64f2d8aa422c6` |
| `private.integrated_manual_commit_v2(uuid,uuid,uuid,jsonb,uuid,uuid,jsonb,timestamp with time zone[],uuid,jsonb,jsonb)` | `294934f121eb4be6e46b41cf1e427342` | `294934f121eb4be6e46b41cf1e427342` |

| Cuerpo instalado protegido | MD5 |
|---|---|
| `private.write_practice_contract_v14()` | `bc246e4370f15426d192f5b7bd7d05df` |
| `private.resolve_practice_contract_v14(enrollments)` | `63409564a3b7ca540b85c1919968a8ab` |

### 089

[Inventario JSON 089](inscripcion-089-guardas.json).

| Dependencia o reemplazo | Antes | Después |
|---|---|---|
| `private.practice_replacement_balance(uuid)` | `abd969f79a911133bdce49e98b265dd7` | `abd969f79a911133bdce49e98b265dd7` |
| `private.free_instructors_v2(timestamp with time zone[],uuid,uuid)` | `231b1953a2b029dcf350147fa2d92b02` | `231b1953a2b029dcf350147fa2d92b02` |

| Cuerpo instalado protegido | MD5 |
|---|---|
| `private.practice_block_options_v14(uuid,date)` | `3e71e918864f829d3fc95aabfafac86a` |
| `private.practice_block_v14(uuid,uuid,date)` | `6b48e665db82f1d16a1501d8e58b8c85` |
| `private.practice_block_effect_v14(text,integer)` | `fcde7be22e2a24292069ddd384dcf8c6` |
| `preview_practice_block_cancellation_v14(uuid,uuid,date)` | `ed2f39e37495cb1d08a6ebea53cb7216` |
| `private.notify_released_block_v14(uuid)` | `2c0d07aaeea4d36bac4f5bdb37a41849` |
| `cancel_practice_block_with_reason_v14(uuid,uuid,date,text,text)` | `66e5c7cf21f698bd96ee088b796eac3c` |
| `confirm_practice_block_v14(uuid,uuid,date)` | `4c21eec9ce2e052b9391e107ed27be6f` |

### 090

[Inventario JSON 090](inscripcion-090-guardas.json).

| Dependencia o reemplazo | Antes | Después |
|---|---|---|
| `private.reserve_schedule_v2(uuid,uuid,jsonb)` | `b6b2ee2afd0866b255ccaa9ef1fbd26c` | `8a3a24737c168e6e681556688d5dd66a` |
| `private.confirm_payment_v2(uuid,text,text,text,bigint,text,text,text)` | `6fbf8dea16054980095bd760988b2baf` | `9291bb7618029eec0cf60cb43369fd3b` |
| `private.confirm_plan_change_v2(uuid,uuid,uuid)` | `7367c7611d0c2eba97f64f2d8aa422c6` | `05a7e7af217d5516e536ee2d7725bafe` |

| Cuerpo instalado protegido | MD5 |
|---|---|
| `student_practice_block_options_v14(uuid)` | `8309997a78af2bd7d4bf8b073e1806da` |
| `student_practice_block_summary_v14(uuid)` | `209dbdd18865812ece2e054ceb902483` |
| `take_practice_block_v14(uuid,uuid,text)` | `a206d11976c334e90a31348071e8e0a0` |
| `private.reserve_schedule_v2(uuid,uuid,jsonb)` | `8a3a24737c168e6e681556688d5dd66a` |
| `private.confirm_payment_v2(uuid,text,text,text,bigint,text,text,text)` | `9291bb7618029eec0cf60cb43369fd3b` |
| `private.confirm_plan_change_v2(uuid,uuid,uuid)` | `05a7e7af217d5516e536ee2d7725bafe` |

### 091

[Inventario JSON 091](inscripcion-091-guardas.json).

| Dependencia o reemplazo | Antes | Después |
|---|---|---|
| `private.notify_released_block_v14(uuid)` | `2c0d07aaeea4d36bac4f5bdb37a41849` | `1ece6f5e6cd66087ea65e8b29f826fbb` |
| `cancel_practice_block_with_reason_v14(uuid,uuid,date,text,text)` | `66e5c7cf21f698bd96ee088b796eac3c` | `a3a4703ac5b5c908ef392fed708d1be8` |
| `take_practice_block_v14(uuid,uuid,text)` | `a206d11976c334e90a31348071e8e0a0` | `8cb5513f1f4f47c5c12eb97973f1c6af` |
| `transition_practice_slot_for_scheduler(uuid,text,text)` | `e9a05c800b9daf2081be77f9c6b3691f` | `d5cbecbfc7f35a57691cc29a207e7b55` |
| `private.practice_block_v14(uuid,uuid,date)` | `6b48e665db82f1d16a1501d8e58b8c85` | `884fb434efa35e480627daa4d92f1814` |
| `private.practice_block_options_v14(uuid,date)` | `3e71e918864f829d3fc95aabfafac86a` | `acb4a4722fd4c32746b2da0acbbcd737` |
| `confirm_practice_block_v14(uuid,uuid,date)` | `4c21eec9ce2e052b9391e107ed27be6f` | `36c45e621e8c5a7b121b095b9dbd13bd` |
| `student_practice_history(uuid,uuid,integer,integer)` | `f51b4183d6f4c83f10cf9988e7cbd4b2` | `539beba6c7bcf5e149e07b40398eb1e6` |

| Cuerpo instalado protegido | MD5 |
|---|---|
| `private.practice_block_options_v14(uuid,date)` | `acb4a4722fd4c32746b2da0acbbcd737` |
| `private.practice_block_v14(uuid,uuid,date)` | `884fb434efa35e480627daa4d92f1814` |
| `take_practice_block_v14(uuid,uuid,text)` | `8cb5513f1f4f47c5c12eb97973f1c6af` |
| `private.base_scheduler_transition_v14(uuid,text,text)` | `e9a05c800b9daf2081be77f9c6b3691f` |
| `transition_practice_slot_for_scheduler(uuid,text,text)` | `d5cbecbfc7f35a57691cc29a207e7b55` |
| `private.notify_released_block_v14(uuid)` | `1ece6f5e6cd66087ea65e8b29f826fbb` |
| `cancel_practice_block_with_reason_v14(uuid,uuid,date,text,text)` | `a3a4703ac5b5c908ef392fed708d1be8` |
| `private.practice_block_result_message_v14(jsonb,text,integer)` | `56683e3692d18da51511cc4019c65c4b` |
| `private.practice_block_instructor_notice_v14(uuid,uuid,text)` | `318b205fca48cd7b7707779dbe95e1e9` |
| `private.practice_block_absence_notice_v14(uuid,uuid,jsonb)` | `47c6819d802f7333e64819b6858989da` |
| `admin_practice_absences_v14(uuid,uuid)` | `7d126722c847189276f03d2ed7ee5c4e` |
| `confirm_practice_block_v14(uuid,uuid,date)` | `36c45e621e8c5a7b121b095b9dbd13bd` |
| `instructor_practice_blocks_v14(uuid,date,date)` | `33b9d31cf269f339877543a393027864` |
| `student_practice_history(uuid,uuid,integer,integer)` | `539beba6c7bcf5e149e07b40398eb1e6` |

Guarda de esquema `notifications_tipo_check`: `5fd97756c26548e0b84287fc153a1b33`, calculada sobre `pg_get_constraintdef`.

Restricción nueva `notifications_blocks_inbox_only_v14`: `CHECK (((tipo <> ALL (ARRAY['cambio_agenda_instructor'::text, 'falta_registrada_admin'::text])) OR (email_status IS NULL)))`.

## SQL y diferencias

SQL completos: [088](../../migrations/088_contrato_asistencia.sql), [089](../../migrations/089_asistencia_bloques.sql), [090](../../migrations/090_reposicion_bloques.sql) y [091](../../migrations/091_avisos_bloques.sql).

El artefacto de sesión `/tmp/c14/migraciones.diff` usa `git diff --unified=3 d1525ac..HEAD -- migrations`: contiene los SQL completos y tres líneas de contexto cuando existe contenido previo. Preflight, verificación y rollback están enlazados en la operación.

La verificación pendiente es S7 con dos sesiones reales. La base real no se consultó: los cero casos indeducibles son del escenario local S5, no una afirmación sobre producción. No se ejecutaron suite, lint, build, SMTP ni navegador; no se actualizaron archivos de pruebas existentes salvo el manifiesto solicitado.
