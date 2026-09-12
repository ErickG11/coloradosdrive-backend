# ADR 008: Nombres embebidos en el listado de franjas, no ampliar /users por rol

## Estado

Aceptado. Reemplaza el enfoque introducido en PR #9 (`GET /users?rol=`)
y ampliado en PR #11 (abrir `rol=instructor` a cualquier autenticado).

## Contexto

El frontend de Sprint 4 (horarios de práctica) necesita mostrar, junto a
cada franja, el nombre del instructor y (si tiene) del estudiante
asignado - no solo sus IDs. El primer enfoque fue agregar `GET
/users?rol=<rol>` (admin-only) para que el panel de administrador
pudiera resolver esos nombres. Según fueron apareciendo más pantallas,
ese mismo problema volvió a aparecer para roles sin acceso a ese
endpoint:

- El estudiante necesitaba el nombre del instructor de su propia
  franja → se amplió `rol=instructor` a cualquier autenticado (PR #11),
  dejando `rol=estudiante`/`rol=admin` todavía admin-only.
- El instructor necesitaba el nombre del estudiante asignado a sus
  franjas → hubiera requerido ampliar también `rol=estudiante`, esta vez
  a instructor+admin.

Seguir por ese camino significa re-evaluar, cada vez que aparece una
pantalla nueva, si es seguro que un rol adicional pueda listar
usuarios de otro rol completo - una superficie de permisos que crece
sin límite claro, para resolver un problema mucho más angosto: cada
pantalla solo necesita el nombre de una persona específica ya
referenciada en una franja que esa persona ya tiene permiso de ver, no
la capacidad general de listar a todos los de un rol.

## Decisión

`GET /users?rol=` vuelve a ser estrictamente admin-only (revierte
PR #11). En su lugar, los 3 métodos de listado de
`PracticeSlotService` (`listSlotsForAdmin`, `listSlotsForStudent`,
`listSlotsForInstructor`) embeben `instructorName`/`studentName`
directamente en cada fila, resueltos del lado del backend con un solo
`SELECT` por listado (sin N+1):

```sql
select *,
  instructor:users!practice_slots_instructor_id_fkey(nombre_completo),
  student:users!practice_slots_student_id_fkey(nombre_completo)
from practice_slots ...
```

`practice_slots` tiene 2 FKs hacia `users` (`instructor_id`,
`student_id`), así que el embed de PostgREST necesita desambiguar con
el nombre de constraint (`users!<fk>`, no solo `users(...)`) - los
nombres usados son los que Postgres asigna por defecto a un `references
users (id)` inline sin nombre explícito en la migración 005
(`<tabla>_<columna>_fkey`).

`database.types.ts` declaraba `Relationships: []` en todas las tablas a
propósito ("no hacemos selects anidados/embebidos vía foreign keys en
este proyecto"). Se agregan las 2 relaciones de `practice_slots` como
la única excepción declarada, en vez de tipar el resultado del embed
con un cast manual sin respaldo del tipo `Database`.

Las acciones (`claim`/`confirm`/`cancel`/`markAttendance`,
`createSlot`/`updateSlot`) no cambian su forma de retorno (siguen
devolviendo `PracticeSlot`, sin nombres) - el frontend siempre vuelve a
pedir el listado completo después de cualquier acción, así que solo los
3 métodos de listado necesitan el embed.

## Consecuencias

**Positivas**

- La superficie de permisos de `/users` se achica en vez de crecer:
  vuelve a ser exactamente lo que era antes de Sprint 4 (admin-only,
  sin excepciones), y el único consumidor que queda es el selector de
  instructor del formulario de creación de franjas del admin - que ya
  tenía ese acceso de sobra.
- Cada rol solo recibe, para cada franja que ya tiene permiso de ver,
  el nombre de las 2 personas involucradas en ESA franja - nunca la
  lista completa de usuarios de un rol.
- Menos llamadas desde el frontend: las 2 pantallas ya construidas
  (calendario admin, horario de estudiante) dejan de necesitar un
  fetch aparte a `/users?rol=` y el `Map` id→nombre correspondiente.

**Negativas / trade-offs asumidos**

- Los nombres de constraint FK (`practice_slots_instructor_id_fkey`,
  `practice_slots_student_id_fkey`) se asumen con la convención de
  nombrado por defecto de Postgres para un `references` inline sin
  nombre explícito - no se verificó contra una base de datos real
  dentro de este entorno de desarrollo (los tests de integración mockean
  `supabaseAdmin.from`, así que no detectarían un nombre de constraint
  incorrecto). Queda pendiente confirmarlo contra el proyecto real de
  Supabase la primera vez que se despliegue este cambio.
- `overrideTypes<T, { merge: false }>()` (reemplazo de `.returns<T>()`,
  deprecado en la versión de `@supabase/postgrest-js` de este proyecto)
  tiene que ir al final de la cadena de la query, después de todos los
  filtros (`.eq`/`.or`/`.order`) - encadenar un filtro después rompe el
  tipado.

## Alternativas descartadas

- **Seguir ampliando `/users?rol=` por rol** (instructor→estudiante,
  como se iba a hacer para el panel de instructor): descartado por ser
  la causa raíz del problema, no una solución - cada pantalla nueva
  volvería a necesitar su propia decisión de "¿es seguro que este rol
  vea la lista completa de aquel otro rol?".
- **Cast manual del resultado del embed sin declarar `Relationships`**:
  técnicamente más simple (no toca `database.types.ts`), pero deja el
  tipado del embed sin ningún respaldo del compilador más allá del cast
  mismo, y contradice la comentario explícito del archivo sobre por qué
  `Relationships` queda vacío - mejor declarar la excepción real que
  ocultarla detrás de un cast.
