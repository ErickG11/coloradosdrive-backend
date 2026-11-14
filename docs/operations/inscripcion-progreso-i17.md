# I17 · H7

Autorizaciones: 063 para SQL; 042–062 inmutables; sin SQL remoto/.env/servidores/pruebas fuera de F45; sin subagentes.
I17 sustituye reglas antiguas: teléfono local obligatorio, cursando se retira de nuevas entradas, cualquier método verificado vigente permite aprobación.
A en curso. B y C pendientes.

A CERRADA: SQL72de7a6 y backend162b1f7. F45 final63 aplicaciones/41preflights/34verificaciones/44rollbacks OK; 063 aplicación remota pendiente. Typecheck, eslint src, build backend OK. La distinción por método estaba en TS; SQL conserva frescura. Sin pruebas fuera de F45, sin SQL remoto/env/servidores/push. B/C implementadas, revisión y validación frontend en curso.

I17 CERRADA 2026-11-05: A72de7a6(SQL063)/162b1f7(backend). B/C commit frontend a584c0e. Typecheck fuente y lint sin errores/avisos frontend, backend typecheck+eslintsrc; builds ambos OK (frontend webpack33/33 páginas, fuentes descargadas con permiso de red; tsconfig restaurado sin diff). Caché generada anterior conservada en /tmp/i17-next-cache-dx9_x927/cache tras error interno WasmHash; sin cambio de implementación por ese fallo. Aviso heredado metadataBase fuera de alcance. Guion manual frontend docs/operations/inscripcion-i17.md; 063 todavía no aplicada por nosotros. Pendientes solo aplicación manual063 y comprobación manual temas/anchuras/casos. Sin push/SQL remoto/.env/servidores/suites/subagentes. Históricos legibles en backend; cliente exige elección actual. F43 y fase final de pruebas continúan aplazadas.
