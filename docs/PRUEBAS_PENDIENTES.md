# Pruebas pendientes — alcance acordado

Actualizado por instrucción del dueño durante el cierre del lote 1 (2026-11-12).
Solo se ejecutan tipos y pruebas obligatorias del lote/grupo autorizado. No añadir
skips ni rebajar una aserción obligatoria; ante fallo obligatorio, informar y detener.
Las suites preexistentes se conservan, pero no se ejecutan indiscriminadamente.

## Aprobaciones y pruebas que NO se difieren

Orden actual: lote 1 aprobado; **lotes 2–11 autorizados en pasada continua**. Esta instrucción sustituye las paradas por grupos. Avanzar únicamente cuando pasan las pruebas obligatorias del lote actual.

| Lote/grupo | Pruebas obligatorias conservadas |
| --- | --- |
| 1 | Preflight; instalación limpia; actualización con fixtures; backfill con conteos, importes, relaciones y procedencia; rollback; manifiesto F45; tipos |
| 2+3 | 23:59:59/00:00; 12 duraciones en UNA prueba parametrizada con los mismos vectores TS/SQL; hoy con franjas futuras; cambio de mes/año; reserva todo o nada y última franja ocupada; último recurso con dos conexiones reales; pago incierto retenido; 23:55/00:05; precio capturado; cupo por intervalo sin duplicar; webhook duplicado; ninguna respuesta de alumno con nombre/código de cohorte |
| 4+5 | Matrícula única por tipo con dos pestañas; A+B simultáneos; acceso por fechas propias; rechazo directo de RPC sin permiso SQL/RLS; mantener privacidad de respuestas al alumno |
| 6+7 | Cambio conserva origen ante fallo/vencimiento; reasignación masiva todo o nada; cancelación con matriculados bloqueada; mantener restricciones SQL/RLS aplicables |
| 8+9+10 | Factura única por pago y matrícula intacta ante fallo de emisión; revisores concurrentes; ambas revocaciones; presencial sin escaneo; retención por defecto; cédula/pasaporte con mismo número sin colisión |
| 11 | Integración final de invariantes; lint/build completos y chequeos previos a integrar |

## Automatización diferida

No escribir ni ejecutar estas pruebas en los lotes actuales. La columna de lote
identifica la funcionalidad propietaria. Su automatización se revisará en el cierre
del lote 11/antes de integrar, o con autorización expresa anterior. La guía manual
de cada grupo sí debe cubrir los controles afectados con datos, pasos, esperado y reset.

| Prueba diferida | Lote funcional | Riesgo que cubriría | Estado |
| --- | --- | --- | --- |
| Componentes de calendario y presentación de las 12 duraciones | 2+3 | UI que muestra fechas/horas diferentes del constructor obligatorio | Pendiente; las 12 reglas puras NO se difieren |
| Estados visuales de reserva y aviso a dos minutos | 3 | Contador/aviso desincronizado o mensaje incorrecto | QA manual al entregar grupo; automatización diferida |
| Formularios, ayuda de extensión, errores y filtros de cohortes | 4 | Validación o disponibilidad visual distinta del backend | QA manual por grupo |
| Panel del alumno con A/B, acceso y fechas individuales | 5 | Confundir inscripción pendiente con acceso pagado de otro tipo | QA manual; regla de acceso obligatoria en SQL/servicio |
| Botón WhatsApp: configuración, mensaje y codificación | 6 | Enlace equivocado, ausencia de configuración o exposición de datos | QA manual |
| Diálogo de interesados, filtros y contadores visuales | 6 | Mostrar N incorrecto o diálogo cuando N=0 | QA manual; no sustituye invariantes de datos |
| Pantallas de cambio/reasignación, confirmaciones y accesibilidad | 7 | Pérdida de contexto, confirmación errónea o teclado inaccesible | QA manual; atomicidad NO se difiere |
| Formularios de pagador/factura, estados pendientes y acciones administrativas | 8 | UI que confunde pago con emisión o datos del alumno con los del pagador | QA manual; idempotencia/emisión fallida NO se difieren |
| Pantallas de revisión, archivo, revocación y subida de escaneo | 9 | Estado visual o mensajes distintos de las decisiones persistidas | QA manual; invariantes de verificación NO se difieren |
| Formulario de tipo/número de documento extranjero | 10 | Errores visuales de selección/validación por tipo | QA manual; unicidad por tipo/número NO se difiere |
| Métricas del embudo: series, agrupación y representación | 1 y transversal (R15) | Eventos incompletos, duplicados o interpretación errónea del embudo | Pendiente del cierre transversal; indicadores apagados en lote 1 |
| Combinaciones exhaustivas adicionales | 2–10 | Interacciones de casos secundarios no cubiertos por vectores obligatorios | Diferidas; no incluye ninguna prueba obligatoria |
| Cobertura de código global | 11 | Huecos no identificados en áreas no ejercitadas | Diferida; no imponer porcentaje sustituyendo invariantes |
| Recorrido completo extremo a extremo | 11 | Integración Auth/API/UI/pagos/factura y recuperación entre módulos | Diferido; solo entorno local/aislado autorizado |
| Lint/build completos de ambos repositorios | 11 y antes de integrar | Errores globales de compilación/estilo fuera del cambio focal | No repetir por lote |
| Regresión amplia preexistente fuera de obligaciones del grupo | 11 | Efectos laterales en módulos ajenos | Conservar sin nuevas ejecuciones por lote |
| TS2835 en tests/unit/cors.test.ts:43 | 11 | Impide typecheck backend de todos los tests con NodeNext | Reproducido también en bcceca93; archivo no modificado |
| Suite HTTP global bajo sandbox | 11 | Puertos locales bloqueados impiden ejecutar ciertos tests HTTP | Intento preliminar encontró EPERM; no añadir skips |

Las dos pruebas de objetos de contrato frontend creadas inicialmente en lote 1
se retiraron tras el ajuste: eran redundantes con el chequeo de tipos. Sus ejecuciones
previas no se contabilizan como pruebas mantenidas. No son dos skips nuevos.

## Nueve pruebas frontend omitidas preexistentes

No se reactivan, reescriben ni ejecutan ahora. Pertenecen al lote 9 de funcionalidad;
su reactivación queda pendiente del cierre autorizado. Se conserva su estado original.

| Archivo / caso | Lote | Riesgo |
| --- | --- | --- |
| DocumentReviewAfterApproval: revisión documental después de aprobar | 9 | Expediente archivado que pierde revisión de documentos |
| SolicitudesAdmin: mantener panel al salir del filtro | 9 | Pérdida de resultado/contexto tras decisión |
| SolicitudesAdmin: actualización por decisión en otra pestaña | 9 | Panel desactualizado ante revisión concurrente |
| SolicitudDetail: cierre, restauración de foco y fondo | 9 | Bloqueo de navegación/accesibilidad |
| SolicitudDetail: trampa de foco en ambas direcciones | 9 | Navegación por teclado fuera del diálogo |
| SolicitudDetail: acciones documentales | 9 | Botones/estado documental inconsistentes |
| SolicitudDetail: rechazo inline con motivo | 9 | Acciones posteriores a rechazo o motivo no presentado |
| SolicitudDetail: conservar resultado y solo lectura | 9 | Nueva decisión indebida sobre solicitud resuelta |
| SolicitudDetail: separar decisión de solicitud y revisión documental | 9 | Bloquear revisión documental que debe seguir disponible |

## Guías y restablecimiento

[Guion y QA del lote 1](operations/cohortes-lote1.md) y
[resultados reales](operations/cohortes-lote1-resultados.md).
Los grupos futuros añadirán guía manual antes de su entrega. Nunca se marcará
una prueba manual como ejecutada sin haberla realizado.

## Autorización posterior de pasada continua

Lotes 2 al 11 autorizados sin paradas por grupos. Esta instrucción sustituye la
agrupación anterior. Mantener solo pruebas obligatorias y tipos; no activar indicadores.

Lote 4: automatización de formulario (código/estado/cierre, habilitación, motivo, solo lectura, ayuda de extensión, edición de precios y flota) diferida; riesgo de interacción, accesibilidad y recarga visual cubierto por la guía QA manual del lote 4.

Lote 5: pruebas de componentes del selector A/B, cambio con respuestas tardías, extensión individual y excepción de repetición diferidas. Riesgo: selección visual incorrecta o mensaje no anunciado. Guía manual en operations/cohortes-lote5.md.

Lote 6: automatización de Avísame/WhatsApp, filtro y contadores, diálogo N=0/N>0 y reintento de correo diferida; riesgo de interacción, codificación, foco y presentación de entrega frente a cola. Guía manual en operations/cohortes-lote6.md.

Lote 7: componentes de calendario/cambio individual, contador de propuesta, selección masiva/destino, confirmación de capacidad, cancelación y mensajes/foco diferidos; guía manual en operations/cohortes-lote7.md. Atomicidad y conservación del original verificadas en SQL.

Lote 8: formularios del pagador, estado fiscal, registro de autorización existente, reintento y devolución documentada en ficha: componentes/accesibilidad diferidos; riesgo de interpretar cola como emisión o reembolso; QA manual en operations/cohortes-lote8.md.

Lote 9: UI de reclamación/renovación, modo/escaneo, archivo, revocación confirmada, correo en cola/reintento, retención y columna de pago diferidas; riesgos de interacción, foco y presentación. QA manual en operations/cohortes-lote9.md. Nueve pruebas omitidas preexistentes intactas.
