# F07 · Límites e interruptor (044)

Aplicación manual después de 042/043, con despliegue conjunto del flujo terminado.
Ejecutar preflight, migración y verificación (termina ROLLBACK), en ese orden.
Rollback revierte funciones y resumen, **conserva** contadores, eventos y auditoría.
No reiniciar cupos borrando filas para ocultar abuso. No se ejecutó SQL en Supabase.

`reservar_limite_inscripcion` serializa el límite por clave/tipo con advisory lock
transaccional; los topes globales usan el incremento atómico de 042. La ventana
IP de códigos es una hora móvil; los límites diarios se calculan desde medianoche
de America/Guayaquil. El cooldown del correo se comprueba antes de reservar el
presupuesto global. Cada intento aceptado de subida consume cupo, incluso si
después su firma/contenido resultan inválidos. Cero significa agotado.

`crear_borrador_limitado` reserva presupuesto y crea la fila en la misma transacción.
Las colisiones de correo canónico se serializan sin cobrar filas duplicadas; un
error FK/SQL revierte también el incremento. Esta RPC se integra en F09. Los
fallos de código se registrarán en F09 y el gate de subida antes de Multer en F12;
las tres operaciones ya tienen servicio y pruebas SQL, sin afirmar que esos
endpoints antiguos estén sustituidos antes de dichas tareas.

Con inscripciones cerradas se rechaza verificar-correo antes del captcha, sin
consultar si hay cuenta o expediente. El cierre no bloquea subidas ya en curso.
Un cambio concurrente de configuración se serializa con la reserva en curso.
La API solo acepta `inscripcionesAbiertas:boolean`; el actor sale del JWT. SQL
vuelve a exigir administrador activo y guarda auditoría junto al cambio. El
UUID cero en solicitud_auditoria identifica configuración global, sin expediente
ni datos personales. Si falla la auditoría, se revierte el interruptor.

## Contratos activos

- GET /public/inscripcion/config: cursos con edadMinima, versiones, contacto,
  retención, umbral, documentos físicos y claves públicas del captcha. Selección
  explícita de campos, nunca claves secretas ni perfiles.
- GET/PUT /admin/inscripciones/config: JWT de admin; respuestas no-store.
- GET /admin/solicitudes/resumen: elimina documentosPorRevisar; añade devueltas,
  conMasDe48h, cupoCodigosHoy, cupoSubidasHoy, cupoSolicitudesHoy e inscripcionesAbiertas.
  Cada cupo incluye usado/tope/alerta. alertas enumera los que alcanzan 80%, incluido
  el tope cero (agotado). Los topes vienen del servidor, no del cliente.
- POST verificar-correo: límite IP persistente → captcha → validación → límite
  correo/global persistente. No se omiten estos límites con NODE_ENV=test.
  Los errores son 503 INSCRIPCIONES_CERRADAS y 429 CUPO_DIARIO_AGOTADO; fallos de
  infraestructura no habilitan envíos.

Las claves de correo comparan Gmail/googlemail canónicamente. IPv6 agrupa /64,
incluyendo direcciones comprimidas; IPv4 mapeada se convierte a IPv4. Las claves
persistidas son HMAC con contexto independiente de la firma JWT, nunca hashes
simples ni IP/correo en claro. Rotar el secreto reinicia la correspondencia de
límites; hacerlo solo ante incidente, registrando el motivo operativo.

## Variables y proxy

Defaults: códigos globales250/día, nuevas solicitudes150/día, subidas40/día,
subidas5/IP/día, códigos60/IP/hora, códigos5/correo/día, cooldown60s,
fallos10/correo/día. Ver .env.example para ENROLLMENT_*.

TRUST_PROXY_HOPS omiso: **0 desarrollo/test**, **1 producción**. En local no hay
proxy confiable, así que Express debe ignorar X-Forwarded-For. En Railway se
confía solo en el salto que termina TLS; nunca `true` ni toda la cadena. Ajustar
solo si cambia la topología y verificar el proxy real: contar saltos no autentica
proxies arbitrarios ni permite exponer directamente el contenedor a Internet.

## Runbook

Ante alerta 80%: revisar volumen y logs de eventos técnicos, sin exportar claves
HMAC a canales públicos. Para detener altas, cerrar inscripciones en el panel/API
admin. Si el tráfico es legítimo, subir el ENROLLMENT_* correspondiente y
reiniciar el despliegue con configuración nueva; no borrar contadores. Derivar
por WhatsApp y matrícula manual cuando no haya cupo; ese wizard queda intacto.
Ante cupo de subida agotado, el nivel obligatorio queda pendiente por cupo para
permitir envío posterior (F12/F13). Jamás aprobar sin ese requisito: devolver con
REQUIERE_DOCUMENTO_ESTUDIOS cuando ya se puedan recibir archivos.

Ensayos: PostgreSQL embebido, sin servidores ni credenciales; Promise.all en una
conexión serializada comprueba la función atómica, no suplanta un ensayo de carga
con múltiples conexiones reales. Antes del despliegue, verificar manualmente la
topología de proxy y contadores de dos réplicas. Purga de eventos queda en F20.
