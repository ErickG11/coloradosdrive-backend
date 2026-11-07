
## F25 (modo rápido, sin pruebas)
- sesionSolicitud: token nunca en URL/localStorage/sessionStorage; se pierde al recargar; confirmarCodigo lo guarda y guardarDatos lo renueva.
- publicRequest: sin token → TOKEN_INVALIDO_O_VENCIDO local; Authorization solo con conToken; multipart sin Content-Type manual.
- subirCertificado: campos `archivo` y `subtipo`.
- inscripcionErrorMessage: cada código del mapa, fallback por estado HTTP, error de red; requiereVerificarCorreoDeNuevo y sugiereWhatsapp.
- extraerError: lee code/field/detalles.faltantes.
- listarSolicitudes: construcción de query (estado, q recortado) y estadoDeTab.
