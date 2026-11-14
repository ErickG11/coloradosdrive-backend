# Progreso P1 (F26, F27, F28)
- F26 4e96c1d, F27 6cbb46c, F28 380b3b9: cerradas. Build (next build --webpack, variables ficticias) OK. Sin tarea en curso.
- El wizard nuevo vive en components/inscripcion/InscripcionWizard.tsx; el flujo antiguo (InscripcionFlow y pasos legacy) queda sin tocar por sus pruebas; el integrador decide su retirada.
- Pasos de P2: conectar en components/inscripcion/pasos/registro.tsx (PASOS_EXTERNOS 4..7). Si la sesión vence, los pasos llaman irAPaso(1).
- Turbopack rechaza el symlink de node_modules: el build se corrió con --webpack.
