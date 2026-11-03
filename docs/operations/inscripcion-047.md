# F11: datos personales y representante

SQL047 se entrega para aplicación manual después de046. Incluye preflight,
verificación que termina ROLLBACK y rollback repetible. No se ha ejecutado SQL ni
ninguna prueba bajo el método rápido autorizado.

PUT `/solicitudes/:id/datos` recibe nombres, apellidos, cedula, fechaNacimiento,
telefono opcional, nacionalidadTipo, tipoSangre, nivelEstudios opcional y, para menores,
representante {nombre,cedula,acepta:true}. Conserva respuesta {solicitudId,token} y
el expediente original. El cliente no envía nombreCompleto, courseId ni estado.
El nombre completo lo deriva el trigger existente de nombres + apellidos.

Los validadores unificados F05 rechazan campos extra, controles/formatos peligrosos,
cédula inválida, fecha imposible/futura, edad mayor de cien, sangre/nacionalidad/nivel
fuera del catálogo. El teléfono admite los formatos ecuatorianos y +593; omitirlo lo
limpia. Los nombres usan 2–60 caracteres por parte y se normalizan en NFC.
Extranjero sin cédula: ATENCION_POR_CONTACTO, sin guardar. Menos de décimo:
NIVEL_ESTUDIOS_NO_ADMITIDO, sin guardar. El nivel se puede guardar desde el paso de
estudios, reenviando los datos completos; si se omite se conserva el nivel anterior.

La edad mínima se lee del curso del expediente, sin aceptar cambios de curso.
Si es inferior a dieciocho y el postulante es menor, se exigen nombre, cédula válida
distinta y autorización del representante. Una persona adulta no envía representante.
La autorización incluye el tratamiento descrito en el aviso vigente. El progreso
permite reanudar estos datos únicamente con el token de esa solicitud y no-store.

La RPC de servicio bloquea la solicitud, verifica correo/estado editable y ambas
versiones de consentimiento, bloquea la fila del curso y vuelve a comprobar edad
en America/Guayaquil. Guarda representante y datos en la misma transacción, preserva
las fechas originales y audita solo el identificador técnico. Devuelta puede editarse
aunque conserve enviada_at. Enviada/aprobada/rechazada no admiten cambios.

La unicidad mantiene el diseño de042: los borradores no reservan cédula; se rechaza
cuando ya existe en users o en otra enviada/devuelta/aprobada. Conflictos de índice
y precomprobaciones devuelven siempre DATOS_NO_REGISTRADOS y el mensaje genérico,
sin datos del titular ni nombre de la restricción. Un lock de cédula serializa las
escrituras del flujo; F13 y F15 deben compartir `cedula_inscripcion:<cedula>` al
enviar/aprobar. Se conserva intacto el flujo de matrícula manual: F13/F15 vuelven a
comprobar usuarios y el índice users sigue siendo la autoridad al crear el perfil.

La columna aditiva datos_actualizados_at cambia solo cuando cambian los datos o
el representante; un reintento idéntico no cambia la marca ni duplica auditoría.
F14/F15 deben exigir verificaciones posteriores a esa marca. Cambiar nivel elimina
el flag de documento pendiente por cupo; F12 comprueba el certificado/subtipo frente
al nivel vigente. No se modifica ni transforma un documento legacy.

Rollback elimina únicamente la RPC, conservando datos y la marca de frescura. No
altera extensiones, grants generales, Realtime, Storage ni el wizard manual.
Autorrevisión: S1/S5 (mensaje genérico y validadores), S7/S8 (scope/estado), S9
(transacción, locks e índice), S10 (parámetros), S11 (PII solo en datos propios y
no-store; auditoría sin PII), S16 (consentimiento vigente/representante).
Casos pendientes específicos en inscripcion-pruebas-pendientes.md, sin commit.
