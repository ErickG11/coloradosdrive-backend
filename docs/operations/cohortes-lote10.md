# Lote 10 — identidad por tipo y número (080)

`foreign_identity` implementado y apagado. Usuarios y solicitudes guardan tipo (`cedula`, `pasaporte`, `otro`) y número canónico (espacios exteriores retirados, mayúsculas). La unicidad es del par. La columna legacy `cedula` conserva solo cédulas y queda NULL para los otros tipos; nunca se introduce un pasaporte dentro de una cédula ficticia. Los contratos compatibles incorporan el documento explícito; alias legacy vacío en proyecciones de perfiles no cedulados. Los lectores muestran tipo y número, sin etiquetar un pasaporte como cédula.

Backfill literal desde la cédula existente, con procedencia técnica por entidad en auditoría, sin copiar números a logs/valores de auditoría. No se infiere el tipo desde nacionalidad ni se cambian números. Las solicitudes sin documento siguen pendientes; los preflights exportan IDs y evidencia para decisión. Un pasaporte y una cédula con el mismo número coexisten; duplicado del mismo par se rechaza con bloqueo por clave y restricción única. La normalización también se aplica a búsquedas antes de paginar.

Solicitud pública y matrícula manual permiten seleccionar el tipo publicado por el servidor. Se conserva la cédula ecuatoriana con su verificador; pasaporte/otro admiten 3–30 letras ASCII, dígitos o guion, sin espacios interiores. Ese límite es validación técnica explícita, no certificación de identidad ni validez internacional. El modo de verificación y la observación siguen siendo obligatorios. El representante de un menor también puede identificarse por tipo/número; no colisiona con el alumno por coincidir el número de un tipo distinto. No hay tabla paralela.

Guardar datos, envío y aprobación conservan las comprobaciones actuales de correo, consentimiento, edad, estudios, estados, frescura y reclamación. La finalización conserva el contrato vigente de 058 (matrícula por_agendar sin cohorte/precio), ampliado solo con los campos de identidad. La aprobación queda archivada con su vínculo. Tipo/número no se editan sobre una solicitud ya enviada/archivada: se devuelve antes de corregir y se verifica de nuevo. La edición de un perfil no cedulado no envía una cédula vacía ni convierte su número en otro tipo.

## Archivos y pruebas reales

080 y sus scripts, manifiesto F45, normalizador de documento, validaciones/modelos/proyecciones, servicios de datos públicos, búsqueda y matrícula manual; formularios, revisión/resumen y lectores existentes. Borrador 064 intacto.

Dos escenarios agrupados en `tests/concurrency/cohortesLote10.ts` pasan localmente:

1. Cédula/pasaporte con número igual, duplicado del mismo tipo, variantes canónicas; solicitud con pasaporte completa datos/envío/revisión/aprobación real junto a cédula existente con el mismo número; solicitud menor con representante por pasaporte; bloqueo de edición de expediente resuelto.
2. Actualización histórica con copia literal/procedencia, rollback → reaplicación conservando documentos y sin duplicar el backfill.

Tipos ambos repositorios OK. No se ejecutó navegador, Auth real, SMTP, lint ni build. UI diferida con guía abajo. Indicadores apagados, sin push.

## Despliegue y rollback

1. Respaldar usuarios/Auth, solicitudes/consentimientos, verificaciones, matrículas, índices y auditoría; restaurar copia aislada. Guardar conteos, nulos, pares por tipo/número y relaciones. Exportaciones protegidas fuera de Git.
2. Preflight 080: exportar identidad incompleta y evidencia disponible. No inferir documentos de nacionalidad ni asignar números artificiales. Casos reales desconocidos: no se consultó una base remota.
3. Ensayar copia tras 079: aplicar 080, verificar con flags apagados; cotejar igualdad literal del backfill, conteos y claves; probar pares iguales/diferentes, un envío/aprobación y menor con representante. Apagar flags; rollback → reaplicar → verificar y comparar. Ciclo probado con fixtures sintéticos.
4. Aplicar 080 manualmente en Supabase. Desplegar lectores/contratos antes de activar la capacidad de documentos. Mantener los 14 indicadores apagados. Activación separada tras QA y cierre global, con permisos nominativos; no hay carga automática de precios o administradores.
5. Verificar índices/RLS/ACL, búsquedas por documento y conservación de solicitudes aprobadas; no basta comprobar que un número tiene diez dígitos para inferir tipo cédula.
6. Rollback funcional: apagar indicadores y revertir lotes posteriores, usar script 080. Conserva columnas, pares, índices, procedencia y lectores compatibles; suspende escrituras nuevas de casos extranjeros hasta reaplicar. Nunca convertir pasaportes en cédulas ni borrar extranjeros para reinstalar NOT NULL legacy. Restaurar escrituras antiguas no es autorización para reinterpretar documentos nuevos. La reaplicación no duplica el backfill.

## Guía QA manual (por ejecutar en copia)

Fixtures: cédula sintética válida `0100000009`, pasaporte con ese mismo número; otro pasaporte `AB-123`; adulto y menor sintéticos (16 años, curso mínimo 15) con representante `GUA-001`. Correo example.test; nombres Fixture/Prueba y teléfono sintético. Admin con permisos de identidad y de matrícula/finanzas según operación. Restaurar snapshot y flags tras cada caso.

| Pasos / datos | Esperado | Restablecer |
| --- | --- | --- |
| Flags apagados, formulario nuevo | Oferta solo cédula y comportamiento de contacto previo para extranjero sin cédula; no inferir tipo | Mantener apagado al cerrar |
| Activar en copia y elegir extranjero sin cédula → pasaporte | Campos de tipo/número, sin desviar a contacto; teléfono/fecha/consentimiento/estudios siguen exigidos | Restaurar formulario/flags |
| Cédula y pasaporte con `0100000009` | Dos identidades diferentes; búsqueda y ficha muestran tipo correcto | Restaurar usuarios/solicitudes |
| Repetir pasaporte mismo número, luego `ab-123`/` AB-123 ` | DOCUMENTO_DUPLICADO para el mismo par normalizado | Consultar existente; restaurar fixture |
| Cédula con verificador incorrecto, tipo inventado, caracteres/longitud inválidos | DOCUMENTO_NUMERO_INVALIDO / TIPO_INVALIDO; no guardar ni crear Auth | Corregir entrada |
| Enviar tipo nuevo con flag apagado | DOCUMENTO_REGLAS_INACTIVAS, sin convertir número | Mantener apagado |
| Volver a cédula después de seleccionar pasaporte | No reutiliza silenciosamente el número; validar cédula | Restaurar selección |
| Guardar, cerrar y verificar correo otra vez | Conserva tipo/número y progreso de datos; no exige cédula ausente a pasaporte | Reponer snapshot |
| Menor con representante por pasaporte/otro | Documento del representante guardado, consentimiento/autorización obligatorios | Restaurar solicitud/consentimiento |
| Mismo tipo y número para alumno y representante | Rechazo de representante; tipo diferente con mismo número no se confunde | Corregir representante |
| Enviar/aprobar pasaporte | Se conserva tipo/número en cuenta, matrícula por_agendar y solicitud archivada; cédula legacy NULL, sin documento inventado | Restaurar cuenta/Auth sintética |
| Cambiar tipo/número en expediente enviado/archivado | DOCUMENTO_ESTADO_NO_EDITABLE; devolver antes de corregir/verificar | Restaurar estado de copia |
| Buscar en matrícula manual y Alumnos por pasaporte/nombre/correo | Resultados identificados por tipo; filtros se aplican antes de paginar | Limpiar búsqueda |
| Matricular nuevo con pasaporte; dos admins con mismo par | Solo una identidad confirmada; perdedor recibe DOCUMENTO_DUPLICADO y no conserva una cuenta creada sin matrícula | Restaurar operación/Auth sintética |
| Revisar/resumir/imprimir documentos | Tipo/número y documento original correctos, sin etiquetas que conviertan pasaporte en cédula | Restaurar UI/fixture |
| Editar teléfono/dirección de perfil no cedulado | Guarda sin enviar cédula vacía; documento permanece explícito y no se reinterpreta | Restaurar perfil |
| Reaplicar tras rollback con extranjeros existentes | Conserva pares y procedencia; no duplica eventos ni cambia tipo | Mantener lector compatible y flags apagados |

Los rechazos heredados de datos/edad/consentimiento/documentos conservan sus guías L9 y previas. No hay alertas nuevas específicas: un rechazo de permiso o datos ajenos se integra en seguridad L11. Pendiente: QA manual y automatización de componentes diferida. La corrección de identidad de un expediente resuelto requiere el procedimiento administrativo de revisión, no un cambio libre de tipo desde el perfil. No activar hasta cerrar la integración global.
