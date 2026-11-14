# Progreso B2
Cerradas: F18 c463bf6, F19 (SQL054 799afa5; código b45a2d2), F21 4461ac3. En curso: ninguna. Siguiente: ninguna.
- Migraciones usadas: solo 054 (SQL de F19). 055 y 056 sin usar. F18 y F21 no requieren SQL; las columnas de 042 existen.
- Typecheck, lint y build ok. Sin pruebas ejecutadas (modo rápido).
- Contratos: inscripcion-contratos-backend-b2.md. Pruebas pendientes: inscripcion-pruebas-pendientes-b2.md.
- Doc en git: docs/operations/inscripcion-054.md, inscripcion-mfa-auth.md.
- Cambio compartido: apiRouter.use('/admin', adminMfaGuard()) va al inicio de routes/index.ts (debe preceder a los routers /admin/*); types de enrollments y 2 RPC añadidos a database.types.ts.
