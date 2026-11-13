# Progreso P4 (frontend admin solicitudes F34-F36)

Worktree frontend rama worktree-agent-ad420eb78e8707a6a reiniciada sobre feat/inscripcion-en-linea-ui 08477a2. node_modules por symlink sin commitear.

## F34 cerrada (ef49c14)
- Lista con pestañas, busqueda, insignia 48 h, interruptor con Modal, medidores, contador del menu (useSolicitudSummary usa getResumenSolicitudes; Sidebar sin cambios).
- Retirados ReviewActions, ReviewOutcome, DocumentViewer. DeleteSolicitud adaptado.
- Tests viejos en tests/components/solicitudes-admin/* usan el contrato antiguo: no compilan; NO tocados.

## En curso: F35. Siguiente: F36.

## F35 cerrada
- DatosDeclarados, VerificacionesPanel, CertificadoPanel, ConsentimientoPanel, lib/content/verificacion-links.ts. Registrar verificacion solo si estado=enviada.
- Enlace Registro Civil marcado por confirmar (pagina institucional).

## En curso: F36 (decision).

## F36 cerrada (fcf3cf7). P4 completo.
- DecisionPanel, ResultadoDecisionCard, decisionTipos. studentId leido opcional (no declarado en types/inscripcion.ts): el backend debe devolverlo para reenviar enlace.
- Build: turbopack rechaza el symlink de node_modules; next build --webpack compila; typecheck falla solo por tests viejos de solicitudes-admin + 2 preexistentes.
