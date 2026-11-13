# Progreso P2 (F29-F31)

F29 9ef2362, F30 bfb3aed, F31 cerrada. Siguiente: ninguna (P2 completo).
Notas: worktree reseteado a feat/inscripcion-en-linea-ui (08477a2); build con next build --webpack (Turbopack rechaza el symlink de node_modules). Componentes en components/inscripcion/pasos/, sin conectar al wizard. PantallaInscripcionesCerradas exportada por PantallasEstado.tsx.
Contrato asumido: guardarDatos reenvia todos los datos con nivelEstudios; el progreso no trae estado de verificaciones, el seguimiento solo marca Recibida.
