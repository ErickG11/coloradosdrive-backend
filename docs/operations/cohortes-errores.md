# Errores de cohortes e inscripción

SQL P7000 transporta solo códigos del catálogo. El backend devuelve código, HTTP y mensaje al alumno; no devuelve los detalles SQL. No registrar nombres, correos, documentos, tokens ni tarjetas.

| Código | Causa | HTTP | Alumno | Administrador | Acción |
| --- | --- | --- | --- | --- | --- |
| PLAN_CONFIG_NO_DISPONIBLE | No se pudo leer la configuración del plan | 503 | No se pudo consultar el plan. Intenta nuevamente. | La configuración de reglas no está disponible. | Verificar la configuración y reintentar. |
| PLAN_ENTRADA_INVALIDA | Formato, modalidad u horas fuera de rango | 400 | Revisa la fecha, modalidad y horas de tu plan. | El plan debe tener 15 horas, de 1 a 6 por día y franjas de 06:00 a 22:00. | Corregir los campos indicados y volver a consultar. |
| PLAN_INICIO_PASADO | Primera fecha anterior al día de Guayaquil | 409 | Elige una fecha de inicio desde hoy. | El inicio efectivo del plan está en el pasado. | Seleccionar una fecha vigente. |
| PLAN_FRANJA_PASADA | Alguna franja ya comenzó | 409 | Esa hora ya pasó. Elige una hora posterior. | Todas las franjas deben ser posteriores al instante del servidor. | Recargar disponibilidad y elegir otra hora. |
| COHORTE_FECHAS_INVALIDAS | Cadena de fechas inválida | 422 | No se puede utilizar ese período de inscripción. | Debe cumplirse inicio de matrícula ≤ fin de matrícula ≤ fin del curso e inicio del curso ≤ fin del curso. | Ajustar las fechas relacionadas en una sola operación. |
| PLAN_OPCION_NO_OFERTADA | La combinación de modalidad y horas no está habilitada. | 422 | La combinación de modalidad y horas no está habilitada. | La combinación de modalidad y horas no está habilitada. | Elegir otra combinación o aprobar su configuración. |
| RESERVA_MATRICULA_AJENA | No puedes operar sobre esa inscripción. | 403 | No puedes operar sobre esa inscripción. | No puedes operar sobre esa inscripción. | Comprobar el usuario autenticado y la pertenencia de la matrícula. |
| RESERVA_CUENTA_NO_HABILITADA | Tu cuenta no está habilitada para reservar. | 403 | Tu cuenta no está habilitada para reservar. | Tu cuenta no está habilitada para reservar. | Revisar el estado y la verificación de la cuenta. |
| RESERVA_ESTADO_NO_PERMITIDO | Tu inscripción no permite reservar en este momento. | 409 | Tu inscripción no permite reservar en este momento. | Tu inscripción no permite reservar en este momento. | Consultar la inscripción y su reserva vigente. |
| RESERVA_LIMITE_EXPIRADAS | Alcanzaste el límite de reservas vencidas. Espera antes de volver a intentar. | 429 | Alcanzaste el límite de reservas vencidas. Espera antes de volver a intentar. | Alcanzaste el límite de reservas vencidas. Espera antes de volver a intentar. | Revisar el límite diario y la espera configurada. |
| RESERVA_RECURSO_OCUPADO | Una hora acaba de ocuparse. Consulta otro horario. | 409 | Una hora acaba de ocuparse. Consulta otro horario. | Una hora acaba de ocuparse. Consulta otro horario. | Recargar la disponibilidad completa antes de reservar. |
| RESERVA_SOLAPE_PROPIO | Ya tienes una práctica en ese horario. | 409 | Ya tienes una práctica en ese horario. | Ya tienes una práctica en ese horario. | Elegir sesiones que no se solapen con tu agenda. |
| RESERVA_SIN_HORARIOS | No hay horarios disponibles para ese plan. | 409 | No hay horarios disponibles para ese plan. | No hay horarios disponibles para ese plan. | Cambiar fecha, modalidad u hora; solicitar aviso de apertura. |
| RESERVA_ACCION_INVALIDA | La acción solicitada no es válida. | 400 | La acción solicitada no es válida. | La acción solicitada no es válida. | Usar una operación de reserva permitida. |
| RESERVA_REGLAS_INACTIVAS | La nueva modalidad de reserva aún no está disponible. | 409 | La nueva modalidad de reserva aún no está disponible. | La nueva modalidad de reserva aún no está disponible. | Comprobar los indicadores y sus dependencias. |
| RESERVA_NO_AMPLIABLE | Esta reserva no permite ampliar el tiempo. | 409 | Esta reserva no permite ampliar el tiempo. | Esta reserva no permite ampliar el tiempo. | Continuar con el pago o elegir otro horario. |
| RESERVA_NO_ENCONTRADA | No encontramos esa reserva. | 404 | No encontramos esa reserva. | No encontramos esa reserva. | Consultar las reservas de esta inscripción. |
| CAPACIDAD_CONFIG_REQUERIDA | La escuela debe configurar la disponibilidad antes de reservar. | 503 | La escuela debe configurar la disponibilidad antes de reservar. | La escuela debe configurar la disponibilidad antes de reservar. | Configurar explícitamente el número global de vehículos. |
| CAPACIDAD_CUPO_AGOTADO | No hay disponibilidad durante todas las fechas del plan. | 409 | No hay disponibilidad durante todas las fechas del plan. | No hay disponibilidad durante todas las fechas del plan. | Consultar la ocupación por intervalo y elegir otras fechas. |
| CAPACIDAD_HISTORICO_PENDIENTE | La escuela debe revisar las fechas de esta inscripción. | 409 | La escuela debe revisar las fechas de esta inscripción. | La escuela debe revisar las fechas de esta inscripción. | Resolver el preflight con evidencia y excepción auditada. |
| CAPACIDAD_INSTRUCTOR_NO_DISPONIBLE | El instructor ya no está disponible. Consulta otro horario. | 409 | El instructor ya no está disponible. Consulta otro horario. | El instructor ya no está disponible. Consulta otro horario. | Revisar la vigencia y disponibilidad del instructor. |
| CAPACIDAD_VEHICULOS_AGOTADA | No quedan recursos disponibles en esa hora. | 409 | No quedan recursos disponibles en esa hora. | No quedan recursos disponibles en esa hora. | Revisar prácticas simultáneas y vehículos globales. |
| PAGO_PRECIO_NO_CONFIGURADO | El precio aún no está disponible. Contacta con la escuela. | 503 | El precio aún no está disponible. Contacta con la escuela. | El precio aún no está disponible. Contacta con la escuela. | Cargar el precio por tipo mediante el script explícito aprobado. |
| PAGO_EN_PROCESO | El pago sigue en proceso. Espera su resultado y no pagues de nuevo. | 409 | El pago sigue en proceso. Espera su resultado y no pagues de nuevo. | El pago sigue en proceso. Espera su resultado y no pagues de nuevo. | Consultar el proveedor o conciliar antes de liberar recursos. |
| PAGO_ENTRADA_INVALIDA | Revisa los datos del intento de pago. | 400 | Revisa los datos del intento de pago. | Revisa los datos del intento de pago. | Verificar proveedor, identificador e importes. |
| PAGO_CUENTA_NO_HABILITADA | Tu cuenta no está habilitada para pagar. | 403 | Tu cuenta no está habilitada para pagar. | Tu cuenta no está habilitada para pagar. | Revisar la cuenta antes de iniciar un pago nuevo. |
| PAGO_IDEMPOTENCIA_CONFLICTO | El intento corresponde a otra operación. Consulta el estado del pago. | 409 | El intento corresponde a otra operación. Consulta el estado del pago. | El intento corresponde a otra operación. Consulta el estado del pago. | Comprobar la clave idempotente y sus entidades. |
| PAGO_INTENTO_PENDIENTE | Ya hay un pago pendiente o recibido. No pagues otra vez. | 409 | Ya hay un pago pendiente o recibido. No pagues otra vez. | Ya hay un pago pendiente o recibido. No pagues otra vez. | Resolver el intento existente antes de crear otro. |
| PAGO_NO_ENCONTRADO | No encontramos ese pago. | 404 | No encontramos ese pago. | No encontramos ese pago. | Consultar el intento asociado a la inscripción. |
| PAGO_REFERENCIA_CONFLICTO | La respuesta del pago requiere revisión. No pagues otra vez. | 409 | La respuesta del pago requiere revisión. No pagues otra vez. | La respuesta del pago requiere revisión. No pagues otra vez. | Conciliar la referencia con el intento original. |
| PAGO_RESERVA_INVALIDA | La reserva no permite iniciar este pago. Consulta su estado. | 409 | La reserva no permite iniciar este pago. Consulta su estado. | La reserva no permite iniciar este pago. Consulta su estado. | Comprobar retenciones, estado y precio fijado. |
| PAGO_RESERVA_NO_ENCONTRADA | No encontramos la reserva de ese pago. | 404 | No encontramos la reserva de ese pago. | No encontramos la reserva de ese pago. | Revisar la reserva y la pertenencia del intento. |
| PAGO_APROBADO_SIN_RECURSOS | Recibimos el pago y la escuela debe revisar la asignación. No pagues de nuevo. | 409 | Recibimos el pago y la escuela debe revisar la asignación. No pagues de nuevo. | Recibimos el pago y la escuela debe revisar la asignación. No pagues de nuevo. | Resolver la asignación o documentar la devolución; no simular reembolsos. |
| PAGO_ACTIVACION_REVISION | La escuela está revisando la asignación de tu pago. | 409 | La escuela está revisando la asignación de tu pago. | La escuela está revisando la asignación de tu pago. | Revisar el pago y las prácticas retenidas antes de resolver. |
| PERMISO_REQUERIDO | No tienes permiso para realizar esta operación. | 403 | No tienes permiso para realizar esta operación. | No tienes permiso para realizar esta operación. | Solicitar el permiso específico a un administrador autorizado. |
| COHORTE_NOMBRE_DUPLICADO | Ya existe una cohorte con ese nombre. | 409 | Ya existe una cohorte con ese nombre. | Ya existe una cohorte con ese nombre. | Renombrar la cohorte indicada; se ignoran acentos, mayúsculas y espacios exteriores. |
| COHORTE_TERMINADA | Ese período ya terminó y es de solo lectura. | 409 | Ese período ya terminó y es de solo lectura. | Ese período ya terminó y es de solo lectura. | Crear un período nuevo; no reabrir el terminado. |
| COHORTE_INICIO_INMUTABLE | El inicio ya tiene inscripciones asociadas. | 409 | El inicio ya tiene inscripciones asociadas. | El inicio ya tiene inscripciones asociadas. | Conservar el inicio; gestionar una reasignación si corresponde. |
| COHORTE_CODIGO_INMUTABLE | El código ya tiene inscripciones asociadas. | 409 | El código ya tiene inscripciones asociadas. | El código ya tiene inscripciones asociadas. | Conservar el código autogenerado. |
| COHORTE_FIN_CON_COMPROMISOS | El fin dejaría prácticas fuera del período. | 409 | El fin dejaría prácticas fuera del período. | El fin dejaría prácticas fuera del período. | Revisar el último fin individual de matrículas y reservas. |
| COHORTE_CUPO_INFERIOR | El cupo es inferior a la ocupación del período. | 409 | El cupo es inferior a la ocupación del período. | El cupo es inferior a la ocupación del período. | Mantener al menos el máximo ocupado por intervalo. |
| COHORTE_CANCELACION_BLOQUEADA | Hay matrículas que deben resolverse antes de cancelar. | 409 | Hay matrículas que deben resolverse antes de cancelar. | Hay matrículas que deben resolverse antes de cancelar. | Reasignar o documentar una devolución antes de cancelar. |
| COHORTE_REGLAS_INACTIVAS | La operación aún no está habilitada. | 409 | La operación aún no está habilitada. | La operación aún no está habilitada. | Verificar los indicadores y sus dependencias antes de activar. |
| COHORTE_ENTRADA_INVALIDA | Revisa los datos y el motivo de la operación. | 400 | Revisa los datos y el motivo de la operación. | Revisa los datos y el motivo de la operación. | Corregir formato, campos permitidos, rangos y motivo. |
| COHORTE_NO_ENCONTRADA | No encontramos el período solicitado. | 404 | No encontramos el período solicitado. | No encontramos el período solicitado. | Recargar el listado. |
| COHORTE_CURSO_NO_ENCONTRADO | No encontramos el curso seleccionado. | 404 | No encontramos el curso seleccionado. | No encontramos el curso seleccionado. | Seleccionar un curso existente. |
| COHORTE_VERSION_CONFLICTO | Los datos cambiaron mientras los editabas. | 409 | Los datos cambiaron mientras los editabas. | Los datos cambiaron mientras los editabas. | Recargar los datos actuales antes de volver a guardar. |
| PAGO_PRECIO_INVALIDO | Revisa el importe y el motivo del cambio. | 400 | Revisa el importe y el motivo del cambio. | Revisa el importe y el motivo del cambio. | Indicar centavos enteros dentro de 0–999999 y un motivo. |
| PAGO_PRECIO_CARGA_INICIAL | El precio inicial requiere una carga revisada. | 409 | El precio inicial requiere una carga revisada. | El precio inicial requiere una carga revisada. | Usar exclusivamente la plantilla explícita de precios A/B; nunca 064. |
| CAPACIDAD_ENTRADA_INVALIDA | Revisa la cantidad de recursos y el motivo. | 400 | Revisa la cantidad de recursos y el motivo. | Revisa la cantidad de recursos y el motivo. | Indicar un entero de 0–1000 y un motivo. |
| MATRICULA_TIPO_VIGENTE | Ya tienes una matrícula vigente de ese tipo. | 409 | Ya tienes una matrícula vigente de ese tipo. | Ya tienes una matrícula vigente de ese tipo. | Retomar la inscripción existente; A y B pueden coexistir. |
| MATRICULA_REPETICION_REQUIERE_EXCEPCION | Ya finalizaste ese tipo de curso. La escuela debe autorizar una excepción. | 409 | Ya finalizaste ese tipo de curso. La escuela debe autorizar una excepción. | Ya finalizaste ese tipo de curso. La escuela debe autorizar una excepción. | Registrar motivo y autorización antes de crear la repetición. |
| MATRICULA_CUENTA_NO_HABILITADA | La cuenta no está habilitada para esta operación. | 403 | La cuenta no está habilitada para esta operación. | La cuenta no está habilitada para esta operación. | Revisar el estado de la cuenta. |
| MATRICULA_REGLAS_INACTIVAS | La operación individual aún no está habilitada. | 409 | La operación individual aún no está habilitada. | La operación individual aún no está habilitada. | Revisar el indicador de acceso individual. |
| MATRICULA_NO_ENCONTRADA | No encontramos la matrícula solicitada. | 404 | No encontramos la matrícula solicitada. | No encontramos la matrícula solicitada. | Recargar la ficha del alumno. |
| MATRICULA_ACCESO_ESTADO_INVALIDO | Las fechas de esta matrícula requieren revisión antes de ampliar el acceso. | 409 | Las fechas de esta matrícula requieren revisión antes de ampliar el acceso. | Las fechas de esta matrícula requieren revisión antes de ampliar el acceso. | Comprobar pago, estado y evidencia de fechas del preflight. |
| MATRICULA_EXTENSION_INVALIDA | Revisa la fecha y el motivo de la ampliación. | 400 | Revisa la fecha y el motivo de la ampliación. | Revisa la fecha y el motivo de la ampliación. | Solo extender el fin actual con fecha válida y motivo obligatorio. |
| MATRICULA_REPETICION_ESTADO_INVALIDO | No hay un curso finalizado que permita esta excepción. | 409 | No hay un curso finalizado que permita esta excepción. | No hay un curso finalizado que permita esta excepción. | Revisar las matrículas finalizadas del mismo tipo. |
| MATRICULA_ROLLBACK_CONVIVENCIA | Hay inscripciones A y B vigentes que deben resolverse antes de desactivar. | 409 | Hay inscripciones A y B vigentes que deben resolverse antes de desactivar. | Hay inscripciones A y B vigentes que deben resolverse antes de desactivar. | No borrar datos: decidir el rollback compatible para los casos exportados. |
| PAGO_MONTO_NO_COINCIDE | El importe recibido requiere revisión. No pagues nuevamente. | 409 | El importe recibido requiere revisión. No pagues nuevamente. | El importe recibido requiere revisión. No pagues nuevamente. | Conciliar importe y moneda con la instantánea de la reserva. |
| ESPERA_CUENTA_NO_HABILITADA | Tu cuenta no está habilitada para solicitar este aviso. | 403 | Tu cuenta no está habilitada para solicitar este aviso. | Tu cuenta no está habilitada para solicitar este aviso. | Revisar el estado de la cuenta. |
| ESPERA_REGLAS_INACTIVAS | Los avisos de apertura todavía no están habilitados. | 409 | Los avisos de apertura todavía no están habilitados. | Los avisos de apertura todavía no están habilitados. | Revisar el indicador y sus dependencias. |
| ESPERA_ENTRADA_INVALIDA | Revisa el tipo de curso y el horario preferido. | 400 | Revisa el tipo de curso y el horario preferido. | Revisa el tipo de curso y el horario preferido. | Usar tipo A/B y preferencias estructuradas válidas. |
| ESPERA_PREVIEW_NO_DISPONIBLE | No se pudo comprobar el aviso de disponibilidad. | 503 | No se pudo comprobar el aviso de disponibilidad. | No se pudo comprobar el aviso de disponibilidad. | La cohorte puede estar guardada: recargar y comprobar disponibilidad antes de notificar. |
| MATRICULA_AJENA | No puedes operar sobre esa matrícula. | 403 | No puedes operar sobre esa matrícula. | No puedes operar sobre esa matrícula. | Usar una matrícula que corresponda al sujeto de la operación. |
| PLAN_CAMBIO_REGLAS_INACTIVAS | Los cambios de plan todavía no están habilitados. | 409 | Los cambios de plan todavía no están habilitados. | Los cambios de plan todavía no están habilitados. | Revisar el indicador y las dependencias antes de activar. |
| PLAN_CAMBIO_ESTADO_INVALIDO | Esta matrícula requiere revisión antes de cambiar su plan. | 409 | Esta matrícula requiere revisión antes de cambiar su plan. | Esta matrícula requiere revisión antes de cambiar su plan. | Comprobar estado pagado, fechas demostradas y plan actual. |
| PLAN_CAMBIO_FUERA_PLAZO | El plazo para cambiar este plan ya terminó. Conservamos tu horario actual. | 409 | El plazo para cambiar este plan ya terminó. Conservamos tu horario actual. | El plazo para cambiar este plan ya terminó. Conservamos tu horario actual. | Comparar el instante del servidor con la primera práctica menos la ventana configurada (48 horas iniciales). |
| PLAN_CAMBIO_LIMITE | Ya utilizaste los cambios de plan disponibles. Conservamos tu horario actual. | 409 | Ya utilizaste los cambios de plan disponibles. Conservamos tu horario actual. | Ya utilizaste los cambios de plan disponibles. Conservamos tu horario actual. | Revisar el límite configurado; no crear un cobro alternativo. |
| PLAN_CAMBIO_MOTIVO_REQUERIDO | Escribe el motivo de la reasignación. | 400 | Escribe el motivo de la reasignación. | Escribe el motivo de la reasignación. | Indicar un motivo de 1 a 500 caracteres. |
| PLAN_CAMBIO_RESERVA_VENCIDA | La propuesta venció. Tu horario original se conserva. | 409 | La propuesta venció. Tu horario original se conserva. | La propuesta venció. Tu horario original se conserva. | Consultar el estado y elegir otra propuesta si sigue dentro del plazo. |
| PLAN_CAMBIO_VERSION_CONFLICTO | La matrícula cambió mientras revisabas la propuesta. Conservamos el plan actual. | 409 | La matrícula cambió mientras revisabas la propuesta. Conservamos el plan actual. | La matrícula cambió mientras revisabas la propuesta. Conservamos el plan actual. | Recargar matrícula y capacidad antes de confirmar. |
| PLAN_CAMBIO_RETENCION_INCOMPLETA | La propuesta ya no tiene todas las horas disponibles. Tu horario actual se conserva. | 409 | La propuesta ya no tiene todas las horas disponibles. Tu horario actual se conserva. | La propuesta ya no tiene todas las horas disponibles. Tu horario actual se conserva. | Liberar la propuesta y consultar un plan completo. |
| PLAN_CAMBIO_SIN_COBRO | El cambio de plan no requiere otro pago. | 409 | El cambio de plan no requiere otro pago. | El cambio de plan no requiere otro pago. | Confirmar desde la operación de cambio; no usar caja ni pasarela. |
| PLAN_REASIGNACION_ENTRADA_INVALIDA | Revisa las inscripciones, fechas, versiones y el motivo de la reasignación. | 400 | Revisa las inscripciones, fechas, versiones y el motivo de la reasignación. | Revisa las inscripciones, fechas, versiones y el motivo de la reasignación. | Seleccionar de 1 a 100 matrículas distintas con versiones actuales y planes válidos. |
| MATRICULA_ROLLBACK_HISTORIAL | El historial necesita una revisión antes de restituir la restricción anterior. | 409 | El historial necesita una revisión antes de restituir la restricción anterior. | El historial necesita una revisión antes de restituir la restricción anterior. | Conservar filas y desplegar un rollback compatible; no borrar historia para forzar el índice. |
| PLAN_CAMBIO_SIN_CAMBIOS | La propuesta conserva las mismas franjas y asignación | 400 | Ese es tu horario actual. Elige una propuesta distinta. | No hay cambios en las franjas ni en la asignación. | Conservar el plan o elegir una alternativa; no consumir un cambio gratis. |
| FACTURA_REGLAS_INACTIVAS | La facturación todavía no está habilitada. | 409 | La facturación todavía no está habilitada. | La facturación todavía no está habilitada. | Revisar indicador y fecha de activación. |
| FACTURA_DATOS_INVALIDOS | Revisa los datos de facturación del pagador. | 400 | Revisa los datos de facturación del pagador. | Revisa los datos de facturación del pagador. | Completar nombre, tipo/número de documento, dirección y correo; pueden ser distintos del alumno. |
| FACTURA_ALUMNO_NO_ENCONTRADO | No encontramos el titular de estos pagos. | 404 | No encontramos el titular de estos pagos. | No encontramos el titular de estos pagos. | Recargar la ficha del alumno y comprobar pertenencia. |
| FACTURA_EN_PROCESO | La factura se está procesando. Consulta su estado antes de modificarla. | 409 | La factura se está procesando. Consulta su estado antes de modificarla. | La factura se está procesando. Consulta su estado antes de modificarla. | Esperar lease o reintentar tras vencer; no duplicar emisión. |
| FACTURA_LEASE_INVALIDO | El procesamiento cambió. Consulta el estado fiscal actual. | 409 | El procesamiento cambió. Consulta el estado fiscal actual. | El procesamiento cambió. Consulta el estado fiscal actual. | No finalizar con un token vencido o ajeno. |
| FACTURA_RESULTADO_INVALIDO | La operación fiscal solicitada no es válida. | 400 | La operación fiscal solicitada no es válida. | La operación fiscal solicitada no es válida. | Usar reintento o registro de autorización existente. |
| FACTURA_NO_ENCONTRADA | No encontramos ese documento fiscal. | 404 | No encontramos ese documento fiscal. | No encontramos ese documento fiscal. | Comprobar pago y fecha de activación; históricos no se encolan. |
| FACTURA_VERSION_CONFLICTO | El documento fiscal cambió. Recarga antes de continuar. | 409 | El documento fiscal cambió. Recarga antes de continuar. | El documento fiscal cambió. Recarga antes de continuar. | Usar updatedAt actual sin redondear. |
| FACTURA_YA_EMITIDA | La autorización de este documento ya está registrada. | 409 | La autorización de este documento ya está registrada. | La autorización de este documento ya está registrada. | No volver a emitir; revisar la autorización existente. |
| FACTURA_AUTORIZACION_INVALIDA | Revisa la clave de acceso y la autorización fiscal. | 400 | Revisa la clave de acceso y la autorización fiscal. | Revisa la clave de acceso y la autorización fiscal. | Registrar únicamente autorización real del canal fiscal autorizado, fecha válida y RUC del proveedor. |
| FACTURA_DEVOLUCION_INVALIDA | Revisa el importe, motivo y evidencia de la devolución documentada. | 422 | Revisa el importe, motivo y evidencia de la devolución documentada. | Revisa el importe, motivo y evidencia de la devolución documentada. | No superar importe facturado; emitir nota de crédito solo para devolución real documentada, sin operación del proveedor. |
| FACTURA_IDEMPOTENCIA_CONFLICTO | Esa devolución ya fue documentada con datos distintos. | 409 | Esa devolución ya fue documentada con datos distintos. | Esa devolución ya fue documentada con datos distintos. | Consultar el evento original; no repetir con otra clave para el mismo hecho. |
| SOLICITUD_NO_ENCONTRADA | No encontramos esa solicitud. | 404 | No encontramos esa solicitud. | No encontramos esa solicitud. | Recargar la lista y verificar el expediente solicitado. |
| SOLICITUD_ESTADO_INVALIDO | El estado actual de la solicitud no permite esa operación. | 409 | El estado actual de la solicitud no permite esa operación. | El estado actual de la solicitud no permite esa operación. | Revisar estado, datos completos y correo verificado antes de continuar. |
| SOLICITUD_REVISION_REQUERIDA | Reclama o renueva la revisión antes de continuar. | 409 | Reclama o renueva la revisión antes de continuar. | Reclama o renueva la revisión antes de continuar. | La exclusión venció o pertenece a otro revisor; recargar y reclamar. |
| SOLICITUD_REVISION_OCUPADA | Otra persona está revisando esta solicitud. | 409 | Otra persona está revisando esta solicitud. | Otra persona está revisando esta solicitud. | Esperar el vencimiento de la revisión o coordinar su cierre; no sustituir el actor. |
| SOLICITUD_VERIFICACION_ACTUALIZAR | Usa el formulario actualizado de verificación. | 409 | Usa el formulario actualizado de verificación. | Usa el formulario actualizado de verificación. | Registrar modo, observación y escaneo presencial con la RPC nueva. |
| SOLICITUD_REGLAS_INACTIVAS | Las reglas nuevas de revisión todavía no están habilitadas. | 409 | Las reglas nuevas de revisión todavía no están habilitadas. | Las reglas nuevas de revisión todavía no están habilitadas. | Mantener apagadas hasta cierre y despliegue aprobado. |
| SOLICITUD_VERIFICACION_INVALIDA | Revisa el tipo, método, modo, resultado y observación. | 400 | Revisa el tipo, método, modo, resultado y observación. | Revisa el tipo, método, modo, resultado y observación. | El modo presencial requiere método presencial y observación obligatoria. |
| SOLICITUD_HOMOLOGACION_REQUERIDA | Falta el documento homologado necesario para esa verificación. | 422 | Falta el documento homologado necesario para esa verificación. | Falta el documento homologado necesario para esa verificación. | Comprobar certificado de resolución de homologación vigente. |
| SOLICITUD_ESCANEO_REQUERIDO | La verificación presencial necesita un escaneo legible. | 422 | La verificación presencial necesita un escaneo legible. | La verificación presencial necesita un escaneo legible. | Adjuntar PDF/JPG/PNG válido, hasta 2 MiB, al mismo expediente; SQL comprueba el objeto. |
| SOLICITUD_ESCANEO_NO_DISPONIBLE | No se pudo guardar o abrir el escaneo. | 503 | No se pudo guardar o abrir el escaneo. | No se pudo guardar o abrir el escaneo. | Revisar Storage, retención y registro de auditoría; no afirmar que está guardado. |
| SOLICITUD_APROBACION_SIN_COHORTE | La aprobación debe crear una inscripción pendiente de horario. | 409 | La aprobación debe crear una inscripción pendiente de horario. | La aprobación debe crear una inscripción pendiente de horario. | No asignar cohorte, precio ni monto en la aprobación. |
| SOLICITUD_ARCHIVO_NO_BORRABLE | El expediente aprobado o archivado se conserva. | 409 | El expediente aprobado o archivado se conserva. | El expediente aprobado o archivado se conserva. | Usar revocación auditada; nunca eliminar solicitud enlazada. |
| SOLICITUD_VERSION_CONFLICTO | La solicitud cambió. Recarga antes de continuar. | 409 | La solicitud cambió. Recarga antes de continuar. | La solicitud cambió. Recarga antes de continuar. | Usar la versión actual del servidor. |
| SOLICITUD_MOTIVO_REQUERIDO | Escribe el motivo de la revocación. | 400 | Escribe el motivo de la revocación. | Escribe el motivo de la revocación. | Motivo de 1 a 500 caracteres; no incluir transcripciones de documentos. |
| SOLICITUD_CORREO_LEASE_INVALIDO | El envío cambió. Consulta su estado antes de reintentar. | 409 | El envío cambió. Consulta su estado antes de reintentar. | El envío cambió. Consulta su estado antes de reintentar. | No finalizar con lease ajeno o vencido. |
| SOLICITUD_RETENCION_INVALIDA | Revisa los plazos y el motivo de retención. | 400 | Revisa los plazos y el motivo de retención. | Revisa los plazos y el motivo de retención. | Usar días enteros positivos; aprobadas/archivadas se conservan, rechazadas puede heredar configuración. |
| SOLICITUD_ACCESO_REVOCADO | Tu acceso requiere revisión de la escuela. | 403 | Tu acceso requiere revisión de la escuela. | Tu acceso requiere revisión de la escuela. | Revisar revocación e identidad; no cobrar ni devolver automáticamente. |
| DOCUMENTO_TIPO_INVALIDO | Selecciona cédula, pasaporte u otro documento. | 400 | Selecciona cédula, pasaporte u otro documento. | Selecciona cédula, pasaporte u otro documento. | Usar un tipo del catálogo; no inferirlo del número. |
| DOCUMENTO_NUMERO_INVALIDO | Revisa el número y el tipo de documento. | 400 | Revisa el número y el tipo de documento. | Revisa el número y el tipo de documento. | Cédula ecuatoriana con verificador válido; pasaporte/otro de 3 a 30 letras ASCII, números o guion, sin espacios interiores. |
| DOCUMENTO_DUPLICADO | Ese documento ya está registrado para el mismo tipo. | 409 | Ese documento ya está registrado para el mismo tipo. | Ese documento ya está registrado para el mismo tipo. | Buscar por tipo y número; tipos distintos pueden compartir número. |
| DOCUMENTO_REGLAS_INACTIVAS | Ese tipo de documento todavía no está habilitado en línea. | 409 | Ese tipo de documento todavía no está habilitado en línea. | Ese tipo de documento todavía no está habilitado en línea. | Activar únicamente después de migración, permisos, QA y autorización operativa. |
| DOCUMENTO_ESTADO_NO_EDITABLE | El documento no se puede cambiar en este estado. | 409 | El documento no se puede cambiar en este estado. | El documento no se puede cambiar en este estado. | Devolver para corrección antes de modificar; conservar evidencia/verificaciones anteriores. |
| PAGO_PRECIO_CAMBIO | El precio cambió desde la consulta. Revisa el precio y confirma nuevamente. | 409 | El precio cambió desde la consulta. Revisa el precio y confirma nuevamente. | El precio cambió desde la consulta. Revisa el precio y confirma nuevamente. | Recargar la vista previa; no aceptar un cobro distinto sin confirmación. |
| CONFIG_DEPENDENCIA_REQUERIDA | La configuración requiere activar sus dependencias en una misma transacción. | 409 | La configuración requiere activar sus dependencias en una misma transacción. | La configuración requiere activar sus dependencias en una misma transacción. | Revisar el orden del guion de activación y conservar todos los indicadores apagados si falla. |
| CONFIG_OBSERVACION_INVALIDA | El identificador o resultado del trabajo periódico no es válido. | 400 | El identificador o resultado del trabajo periódico no es válido. | El identificador o resultado del trabajo periódico no es válido. | Usar solo el catálogo cerrado de trabajos y estados. |
| FACTURA_DEVOLUCION_DOCUMENTADA | La reducción de un cobro requiere una devolución documentada. | 409 | La reducción de un cobro requiere una devolución documentada. | La reducción de un cobro requiere una devolución documentada. | Documentar importe, motivo y referencia; no sobrescribir el abono ni simular al proveedor. |

## Alertas implementadas (L3)

| Código | Severidad | Destinatario | Causa y acción | Deduplicación/cierre |
| --- | --- | --- | --- | --- |
| PAGO_CONCILIACION_NO_OPERATIVA | Alta | view_payments_invoices | Consulta de Kushki no disponible; revisar referencia en proveedor | Usuario+código+pago; 1 día, RESUELTO cierra |
| PAGO_DESPACHADO_INCIERTO | Alta | view_payments_invoices | Despacho sin resultado; no liberar ni volver a cobrar | Usuario+código+pago; 1 día, RESUELTO cierra |

Reproducción manual y restablecimiento: [guía L3](cohortes-lote3.md). Las alertas de causas introducidas en lotes posteriores se añadirán con sus reglas; no hay un módulo paralelo de alertas.

L4: CAPACIDAD_HORAS_SOBRE_LIMITE (alta, manage_cohorts_prices), una notificación abierta por usuario/código/configuración; al corregir flota se cierra. Reproducción y restablecimiento de los códigos nuevos: [QA L4](cohortes-lote4.md). El nombre duplicado se identifica solo en la respuesta administrativa.

L5: reproducción de todos los rechazos nuevos y restablecimiento en [QA de matrículas](cohortes-lote5.md). Los históricos sin guard conservan el comportamiento anterior hasta aprobar evidencia.

L6: ESPERA_CORREO_FALLIDO (alta, manage_cohorts_prices): clave usuario/código/notificación, enfriamiento de un día, cierre tras entrega. Reintento con motivo en Alumnos conserva el evento. Reproducción de códigos y alerta: [QA L6](cohortes-lote6.md).

L7: rechazos de cambio, reasignación y cancelación: [QA L7](cohortes-lote7.md). El aviso plan_cambiado reutiliza el outbox de correo.

L8: FACTURA_ENCOLADO_FALLIDO y FACTURA_PENDIENTE (alta, view_payments_invoices), evento por documento/pago y usuario, enfriamiento 1 día; cierre al recuperar cola/registrar autorización. [Reproducción y reset L8](cohortes-lote8.md).

L9: SOLICITUD_REVOCADA_CON_PAGO y SOLICITUD_CORREO_ATASCADO (alta, verify_identity), usuario+código+solicitud, enfriamiento 1 día; correo se cierra al entregar. El caso pagado conserva revisión hasta resolución administrativa. [QA L9](cohortes-lote9.md).

L10: DOCUMENTO_* se reproduce/restablece en [QA de documento tipado](cohortes-lote10.md); no añade un módulo de alertas.

## Preparación manual de códigos (sin ejecutar)

| Código | Cómo provocarlo en la copia local | HTTP esperado |
| --- | --- | ---: |
| PLAN_CONFIG_NO_DISPONIBLE | En la copia, retirar temporalmente SELECT del lector de configuración; abrir Horario y restaurar el GRANT original. | 503 |
| PLAN_ENTRADA_INVALIDA | Enviar la vista previa con horasPorDia=7 o inicio inválido; repetir con sesión que termine después de las 22:00. | 400 |
| PLAN_INICIO_PASADO | Solicitar un plan cuya primera fecha efectiva sea ayer en Guayaquil. | 409 |
| PLAN_FRANJA_PASADA | Elegir hoy y una hora que ya comenzó, conservando el resto del plan válido. | 409 |
| COHORTE_FECHAS_INVALIDAS | Guardar fin de matrícula posterior al fin del curso; repetir con fin del curso anterior a su inicio. | 422 |
| PLAN_OPCION_NO_OFERTADA | Solicitar fin de semana y 1 hora/día mientras esa combinación permanezca deshabilitada. | 422 |
| RESERVA_MATRICULA_AJENA | Con sesión del alumno A, pedir reserva sobre el UUID de matrícula del alumno B. | 403 |
| RESERVA_CUENTA_NO_HABILITADA | Desactivar el alumno del fixture y ejecutar la operación de este dominio desde el backend local; restaurar la cuenta después. | 403 |
| RESERVA_ESTADO_NO_PERMITIDO | Intentar reserva inicial de una matrícula ya activa o sin requisitos verificados. | 409 |
| RESERVA_LIMITE_EXPIRADAS | En la copia crear el límite diario configurado de reservas vencidas del mismo alumno y solicitar otra; repetir durante el cooldown. | 429 |
| RESERVA_RECURSO_OCUPADO | Consultar un plan libre, ocupar su última franja con otro alumno y confirmar la selección anterior. | 409 |
| RESERVA_SOLAPE_PROPIO | Mantener una reserva de A y solicitar B en una hora coincidente; repetir con una práctica asignada. | 409 |
| RESERVA_SIN_HORARIOS | Deshabilitar las candidatas o llenar un día intermedio del intervalo, y solicitar el plan. | 409 |
| RESERVA_ACCION_INVALIDA | Invocar la RPC de gestión con una acción distinta de las admitidas. | 400 |
| RESERVA_REGLAS_INACTIVAS | Con el admin de fixture autorizado y los indicadores apagados, intentar la operación nueva de escritura de este dominio. | 409 |
| RESERVA_NO_AMPLIABLE | Intentar ampliar una reserva del régimen nuevo, que no admite extensiones. | 409 |
| RESERVA_NO_ENCONTRADA | En la operación de este dominio sustituir únicamente el UUID de la entidad por uno inexistente, manteniendo actor y formato válidos. | 404 |
| CAPACIDAD_CONFIG_REQUERIDA | Dejar vehículos globales NULL o sin la carga A/B e intentar activar el grupo de reservas. | 503 |
| CAPACIDAD_CUPO_AGOTADO | Con el último cupo ocupado un día del rango, confirmar otra matrícula en ese intervalo. | 409 |
| CAPACIDAD_HISTORICO_PENDIENTE | Usar matrícula histórica activa sin fechas demostrables al intentar la operación que exige prueba del intervalo. | 409 |
| CAPACIDAD_INSTRUCTOR_NO_DISPONIBLE | Entre vista previa y confirmación desactivar el instructor propuesto, y confirmar. | 409 |
| CAPACIDAD_VEHICULOS_AGOTADA | Con N instructores libres y un vehículo, ocupar la hora y escribir una segunda práctica concurrente. | 409 |
| PAGO_PRECIO_NO_CONFIGURADO | En la copia sin activar reglas, retirar la tarifa del tipo; solicitar vista previa nueva después de preparar la activación válida o llamar al flujo interno desde el backend local. | 503 |
| PAGO_EN_PROCESO | Despachar un intento y solicitar liberar o vencer su reserva antes de un resultado definitivo. | 409 |
| PAGO_ENTRADA_INVALIDA | Enviar proveedor no admitido, importe con formato inválido o recargo fuera del rango. | 400 |
| PAGO_CUENTA_NO_HABILITADA | Desactivar el alumno del fixture y ejecutar la operación de este dominio desde el backend local; restaurar la cuenta después. | 403 |
| PAGO_IDEMPOTENCIA_CONFLICTO | Repetir el attemptKey original con datos de pago diferentes. | 409 |
| PAGO_INTENTO_PENDIENTE | Abrir otro intento para una matrícula con pago pendiente, sin resolver el primero. | 409 |
| PAGO_NO_ENCONTRADO | En la operación de este dominio sustituir únicamente el UUID de la entidad por uno inexistente, manteniendo actor y formato válidos. | 404 |
| PAGO_REFERENCIA_CONFLICTO | Confirmar el pago con una referencia distinta de la ya registrada o utilizada por otro pago. | 409 |
| PAGO_RESERVA_INVALIDA | Iniciar pago sobre una reserva que ya no está vigente o cuya prueba de precio no existe. | 409 |
| PAGO_RESERVA_NO_ENCONTRADA | En la operación de este dominio sustituir únicamente el UUID de la entidad por uno inexistente, manteniendo actor y formato válidos. | 404 |
| PAGO_APROBADO_SIN_RECURSOS | En una copia aislada preparar un pago aprobado cuya retención fue retirada; confirmar sin recrear recursos. | 409 |
| PAGO_ACTIVACION_REVISION | Preparar discrepancia de recursos en la confirmación; intentar activar la matrícula sin resolver su revisión. | 409 |
| PERMISO_REQUERIDO | Conceder solo uno de los cuatro permisos a un admin local; ejecutar una RPC pública de otro permiso como service_role y comprobar el rechazo; como authenticated debe faltar EXECUTE. | 403 |
| COHORTE_NOMBRE_DUPLICADO | Crear «Grupo Á» y luego « grupo a » en otro curso; revisar que el admin vea el nombre en conflicto. | 409 |
| COHORTE_TERMINADA | En una copia con fin del curso ayer, intentar editar cualquier campo o habilitar de nuevo. | 409 |
| COHORTE_INICIO_INMUTABLE | Con una matrícula o reserva existente cambiar el inicio del curso o su curso/tipo. | 409 |
| COHORTE_CODIGO_INMUTABLE | Con una matrícula existente intentar modificar el código por RPC. | 409 |
| COHORTE_FIN_CON_COMPROMISOS | Acortar fin del curso a un día anterior al último fin individual de alumno/reserva. | 409 |
| COHORTE_CUPO_INFERIOR | Bajar cupo por debajo del máximo diario comprometido del intervalo. | 409 |
| COHORTE_CANCELACION_BLOQUEADA | Cancelar una cohorte que todavía tiene matrículas o reservas protegidas, sin reasignarlas. | 409 |
| COHORTE_REGLAS_INACTIVAS | Con el admin de fixture autorizado y los indicadores apagados, intentar la operación nueva de escritura de este dominio. | 409 |
| COHORTE_ENTRADA_INVALIDA | Guardar una cohorte con motivo vacío, campo fuera del contrato o nombre vacío. | 400 |
| COHORTE_NO_ENCONTRADA | En la operación de este dominio sustituir únicamente el UUID de la entidad por uno inexistente, manteniendo actor y formato válidos. | 404 |
| COHORTE_CURSO_NO_ENCONTRADO | En la operación de este dominio sustituir únicamente el UUID de la entidad por uno inexistente, manteniendo actor y formato válidos. | 404 |
| COHORTE_VERSION_CONFLICTO | Guardar desde dos pestañas usando el mismo updatedAt; repetir el guardado de la pestaña antigua. | 409 |
| PAGO_PRECIO_INVALIDO | Editar tarifa con centavos negativos o motivo vacío. | 400 |
| PAGO_PRECIO_CARGA_INICIAL | Intentar crear desde la interfaz una tarifa A/B ausente; debe exigir el script explícito de carga inicial. | 409 |
| CAPACIDAD_ENTRADA_INVALIDA | Guardar vehículos negativos o motivo vacío. | 400 |
| MATRICULA_TIPO_VIGENTE | Confirmar dos matrículas activas del mismo tipo para el mismo alumno; conservar A y B en el control positivo. | 409 |
| MATRICULA_REPETICION_REQUIERE_EXCEPCION | Con una matrícula finalizada intentar otra del mismo tipo sin excepción auditada. | 409 |
| MATRICULA_CUENTA_NO_HABILITADA | Desactivar el alumno del fixture y ejecutar la operación de este dominio desde el backend local; restaurar la cuenta después. | 403 |
| MATRICULA_REGLAS_INACTIVAS | Con el admin de fixture autorizado y los indicadores apagados, intentar la operación nueva de escritura de este dominio. | 409 |
| MATRICULA_NO_ENCONTRADA | En la operación de este dominio sustituir únicamente el UUID de la entidad por uno inexistente, manteniendo actor y formato válidos. | 404 |
| MATRICULA_ACCESO_ESTADO_INVALIDO | Extender acceso de una matrícula anulada, pendiente o sin fechas demostrables. | 409 |
| MATRICULA_EXTENSION_INVALIDA | Extender sin motivo o poner fin de acceso anterior al fin individual de prácticas. | 400 |
| MATRICULA_REPETICION_ESTADO_INVALIDO | Solicitar excepción de repetición sobre una matrícula que aún no está finalizada. | 409 |
| MATRICULA_ROLLBACK_CONVIVENCIA | Con A y B vigentes en la copia, intentar el rollback que restauraría la unicidad global antigua. | 409 |
| PAGO_MONTO_NO_COINCIDE | Enviar confirmación sintética con total o moneda diferentes de la instantánea del pago. | 409 |
| ESPERA_CUENTA_NO_HABILITADA | Desactivar el alumno del fixture y ejecutar la operación de este dominio desde el backend local; restaurar la cuenta después. | 403 |
| ESPERA_REGLAS_INACTIVAS | Con el admin de fixture autorizado y los indicadores apagados, intentar la operación nueva de escritura de este dominio. | 409 |
| ESPERA_ENTRADA_INVALIDA | Guardar preferencia con campos no admitidos, tipo inventado o fechas/horas inválidas. | 400 |
| ESPERA_PREVIEW_NO_DISPONIBLE | Pedir el diálogo de notificación de una cohorte cerrada o sin un plan factible; no debe inventar interesados elegibles. | 503 |
| MATRICULA_AJENA | Con sesión de otro alumno consultar/confirmar un cambio de plan sobre la matrícula ajena. | 403 |
| PLAN_CAMBIO_REGLAS_INACTIVAS | Con el admin de fixture autorizado y los indicadores apagados, intentar la operación nueva de escritura de este dominio. | 409 |
| PLAN_CAMBIO_ESTADO_INVALIDO | Proponer cambio para matrícula sin pago, anulada o sin evidencia individual aprobada. | 409 |
| PLAN_CAMBIO_FUERA_PLAZO | Situar la primera práctica a menos de 48 horas del instante del servidor y pedir el cambio. | 409 |
| PLAN_CAMBIO_LIMITE | Confirmar el número permitido de cambios gratuitos y pedir uno más. | 409 |
| PLAN_CAMBIO_MOTIVO_REQUERIDO | Enviar reasignación administrativa sin motivo o con más de 500 caracteres. | 400 |
| PLAN_CAMBIO_RESERVA_VENCIDA | Reservar la propuesta, dejar vencer su TTL y confirmar; comprobar que el plan original sigue intacto. | 409 |
| PLAN_CAMBIO_VERSION_CONFLICTO | Enviar la versión de matrícula anterior a otra reasignación confirmada. | 409 |
| PLAN_CAMBIO_RETENCION_INCOMPLETA | En una copia retirar una de las 15 retenciones de la propuesta y confirmar; original intacto. | 409 |
| PLAN_CAMBIO_SIN_COBRO | Intentar cotizar/pagar una reserva cuyo purpose es plan_change. | 409 |
| PLAN_REASIGNACION_ENTRADA_INVALIDA | Repetir una matrícula en el lote masivo, omitir versión, dejar la lista vacía o exceder su máximo operativo. | 400 |
| MATRICULA_ROLLBACK_HISTORIAL | Tras confirmar cambios de plan, intentar rollback que perdería su asociación histórica. | 409 |
| PLAN_CAMBIO_SIN_CAMBIOS | Proponer las mismas franjas, asignación y destino que ya tiene el alumno. | 400 |
| FACTURA_REGLAS_INACTIVAS | Con el admin de fixture autorizado y los indicadores apagados, intentar la operación nueva de escritura de este dominio. | 409 |
| FACTURA_DATOS_INVALIDOS | Guardar datos del pagador sin dirección/correo o con tipo de documento no admitido. | 400 |
| FACTURA_ALUMNO_NO_ENCONTRADO | En la operación de este dominio sustituir únicamente el UUID de la entidad por uno inexistente, manteniendo actor y formato válidos. | 404 |
| FACTURA_EN_PROCESO | Reintentar o registrar autorización de un documento con lease fiscal vigente. | 409 |
| FACTURA_LEASE_INVALIDO | Finalizar un documento usando token ajeno o vencido. | 409 |
| FACTURA_RESULTADO_INVALIDO | Finalizar la cola manual con un resultado distinto de MANUAL_PENDING/FAILED. | 400 |
| FACTURA_NO_ENCONTRADA | En la operación de este dominio sustituir únicamente el UUID de la entidad por uno inexistente, manteniendo actor y formato válidos. | 404 |
| FACTURA_VERSION_CONFLICTO | Registrar autorización con updatedAt anterior a un reintento o cambio de estado. | 409 |
| FACTURA_YA_EMITIDA | Volver a registrar otra autorización sobre el mismo documento emitido. | 409 |
| FACTURA_AUTORIZACION_INVALIDA | Registrar clave de acceso con longitud distinta de 49, sin fecha o sin RUC externo válido. | 400 |
| FACTURA_DEVOLUCION_INVALIDA | Documentar devolución sin motivo/referencia, con importe no positivo o superior a lo facturado. | 422 |
| FACTURA_IDEMPOTENCIA_CONFLICTO | Reusar la clave de devolución con otro importe o referencia. | 409 |
| SOLICITUD_NO_ENCONTRADA | En la operación de este dominio sustituir únicamente el UUID de la entidad por uno inexistente, manteniendo actor y formato válidos. | 404 |
| SOLICITUD_ESTADO_INVALIDO | Editar o decidir una solicitud en estado no permitido por esa transición. | 409 |
| SOLICITUD_REVISION_REQUERIDA | Decidir sin reclamar revisión o con un lease que ya venció. | 409 |
| SOLICITUD_REVISION_OCUPADA | Reclamar el mismo expediente desde dos revisores antes de que venza el lease del primero. | 409 |
| SOLICITUD_VERIFICACION_ACTUALIZAR | Con identidad nueva activa invocar el registro heredado sin modo y observación. | 409 |
| SOLICITUD_REGLAS_INACTIVAS | Con el admin de fixture autorizado y los indicadores apagados, intentar la operación nueva de escritura de este dominio. | 409 |
| SOLICITUD_VERIFICACION_INVALIDA | Registrar verificación con modo no admitido u observación vacía. | 400 |
| SOLICITUD_HOMOLOGACION_REQUERIDA | Elegir documento homologado sin indicar evidencia de homologación. | 422 |
| SOLICITUD_ESCANEO_REQUERIDO | Elegir presencial y enviar verificación sin escaneo. | 422 |
| SOLICITUD_ESCANEO_NO_DISPONIBLE | Preparar ruta/hash de escaneo sin objeto de Storage local o simular fallo del almacenamiento local. | 503 |
| SOLICITUD_APROBACION_SIN_COHORTE | Intentar aprobar enviando cohorte o monto en vez de matrícula por_agendar. | 409 |
| SOLICITUD_ARCHIVO_NO_BORRABLE | Intentar borrar un expediente aprobado, archivado o enlazado a alumno. | 409 |
| SOLICITUD_VERSION_CONFLICTO | Revocar o modificar usando el updatedAt anterior a otra decisión. | 409 |
| SOLICITUD_MOTIVO_REQUERIDO | Revocar con motivo vacío. | 400 |
| SOLICITUD_CORREO_LEASE_INVALIDO | Finalizar correo con token de otro envío o lease vencido. | 409 |
| SOLICITUD_RETENCION_INVALIDA | Guardar días no enteros/no positivos o vencimiento de aprobadas/archivadas no admitido. | 400 |
| SOLICITUD_ACCESO_REVOCADO | Revocar aprobación pagada y usar el JWT anterior en una ruta protegida; ni el pago ni la matrícula se borran. | 403 |
| DOCUMENTO_TIPO_INVALIDO | Enviar tipo diferente de cedula/pasaporte/otro. | 400 |
| DOCUMENTO_NUMERO_INVALIDO | Cédula con verificador incorrecto o pasaporte/otro con espacios interiores o más de 30 caracteres. | 400 |
| DOCUMENTO_DUPLICADO | Crear dos identidades del mismo tipo y número normalizado; repetir tipo diferente como control positivo. | 409 |
| DOCUMENTO_REGLAS_INACTIVAS | Con el admin de fixture autorizado y los indicadores apagados, intentar la operación nueva de escritura de este dominio. | 409 |
| DOCUMENTO_ESTADO_NO_EDITABLE | Cambiar tipo/número del expediente enviado o resuelto sin devolverlo para corrección. | 409 |
| PAGO_PRECIO_CAMBIO | Consultar plan de caja a una tarifa y cambiar la tarifa del tipo antes de confirmar la vista previa antigua. | 409 |
| CONFIG_DEPENDENCIA_REQUERIDA | En una sola transacción intentar activar date_rules dejando reservations apagado; rollback automático del cambio de flags. | 409 |
| CONFIG_OBSERVACION_INVALIDA | Enviar a la RPC de latido un nombre de trabajo o estado no perteneciente al catálogo cerrado. | 400 |
| FACTURA_DEVOLUCION_DOCUMENTADA | Con facturación activa reducir montoAbonado en caja; debe pedir devolución documentada, sin sobrescribir el cobro. | 409 |

## Ajustes D1–D10

RESERVA_SOLAPE_PROPIO indica el curso, fecha y hora de la práctica o reserva propia incompatible, nunca nombre/código de cohorte. CAPACIDAD_VEHICULOS_AGOTADA y CAPACIDAD_VEHICULOS_EXCEDIDA quedan retirados del flujo vigente por D3. MATRICULA_PLAN_REQUERIDO (409): la ruta antigua no recibe el plan individual; usar la caja actualizada. No se requiere configurar vehículos.
