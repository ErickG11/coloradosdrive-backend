# A2: edición simple, propuesta sin implementar

Para unos 200 usuarios: sin tabla de operaciones, tokens de operación,
cifrado, clave nueva, leases ni trabajador de edición. Se retira la solución
anterior de la rama A1; queda preservada exclusivamente en la rama de respaldo.

## Perfil y cédula

PATCH /admin/estudiantes/:id, admin; campos permitidos explícitamente y versión
exacta recibida en la ficha. Validar formato ecuatoriano antes de cualquier
cambio. Si llega cédula, consultar su unicidad en users excluyendo el propio
alumno antes de llamar a Auth; no limitar la búsqueda a estudiantes.
Mantener users_cedula_unique como defensa ante carreras: una preconsulta no
reserva una cédula contra otra transacción. Si la unicidad falla después por
concurrencia, la transacción no escribe perfil ni auditoría.

Una RPC nueva se justifica porque Supabase REST no agrupa dos requests en una
transacción: un UPDATE del perfil y una INSERT de auditoría se confirman juntos.
Solo se agrega una tabla de auditoría, justificada por el requisito de actor,
fecha, alumno y nombres de campos realmente cambiados, sin valores ni hashes.
El identificador de auditoría lo genera la base, no es un token de operación.
Sin cambios efectivos, no hay fila de auditoría. Una nueva migración A2 distinta
de 023 cubrirá esa tabla/RPC y sus ACL/RLS; requiere revisión/aprobación previa.

El UPDATE usa id/rol/updated_at como condición, preserva los campos no enviados,
y devuelve 409 si la versión cambió. El trigger real users_set_updated_at está
habilitado, BEFORE UPDATE FOR EACH ROW, con new.updated_at=now() y precisión 6.
Version viaja como string sin pasar por Date. Los tests de A1 prueban seis
decimales en el JSON/parametrización y muestran el fallo al truncar a milisegundos.
A2 añadirá la aserción del argumento real de su RPC con la misma precisión.

## Correo

Auth es la única fuente: no agregar correo a users. Para una edición con correo:
validar perfil, versión y unicidad de cédula primero; consultar correo actual;
actualizar Auth; después confirmar perfil/auditoría en la RPC. No enviar aviso.
Si Auth rechaza explícitamente, devolver el error sin tocar perfil/auditoría.
Si PostgreSQL rechaza explícitamente, intentar revertir el correo una sola vez.
Registrar error operacional con actor/id/código, sin correo ni otros valores.
Si la reversión falla, devolver 503 y requerir corrección administrativa.

Una respuesta RPC perdida no demuestra rechazo de PostgreSQL: puede haber
commit. No revertir Auth automáticamente ante ese resultado incierto; devolver
503, registrar identificadores y revisar estado manualmente. Revertir a ciegas
podría dejar auditoría de correo cambiado cuando Auth ya volvió al anterior.
Tampoco sobrescribir un tercer correo cambiado concurrentemente por otro admin.
Separar las ediciones de correo de perfil reduce la superficie de compensación;
el control de concurrencia de Auth sigue sin una transacción compartida.

## Límite concreto, tres líneas

Si Railway muere después de que Auth acepta y antes de la RPC, no se ejecutan compensación ni log.
Si se pierde la respuesta de la RPC, revertir a ciegas puede deshacer un correo ya auditado.
Sin estado durable se requiere revisión manual; recuperar automáticamente esos casos justificaría persistencia.

El diseño simple cubre rechazos confirmados, con esos límites explícitos. No
se implementa A2 durante la separación de A1 ni se autoriza aplicar migraciones.
Pruebas previstas: validación previa sin llamadas de escritura a Auth, UPDATE
y auditoría atómicos, unicidad concurrente, conflicto de versión con microsegundos,
rechazo de Auth, una sola compensación, reversión fallida y respuesta RPC perdida.
