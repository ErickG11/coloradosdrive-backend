# Pruebas pendientes P3
- F32: token_hash/type se borran de la URL al cargar; verifyOtp NO se llama al cargar, solo al enviar; type distinto de recovery/invite o sin token -> «Enlace no válido».
- F32: contraseña <10 caracteres y confirmación distinta muestran error junto al campo sin llamar a Supabase.
- F32: verifyOtp con otp_expired -> «Este enlace ya no es válido» con WhatsApp y login; error 5xx/red -> mensaje reintentable y el token se conserva.
- F32: verifyOtp ok + updateUser falla -> reintento solo repite updateUser (no vuelve a verifyOtp); weak_password/same_password en el campo.
- F32: éxito -> signOut local y pantalla «Contraseña creada» con botón a /login; foco en el título; metadata robots noindex y meta referrer no-referrer.
- F33: CourseCard enlaza a /inscripcion?courseId=<id> codificado; /inscripcion lo pasa a InscripcionFlow.
