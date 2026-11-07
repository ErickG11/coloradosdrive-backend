import {
  NIVELES_ESTUDIOS,
  METODOS_VERIFICACION,
  metodoHabilitaAprobacion,
  METODOS_MANUALES_VERIFICACION,
  MOTIVOS_RECHAZO,
  DOCUMENTOS_FISICOS,
  NACIONALIDADES,
  TIPOS_SANGRE,
} from '../../src/config/enrollmentCatalog';
import type { NivelEstudios } from '../../src/config/enrollmentCatalog';

test('exactamente seis niveles y una sola clase de archivo según el nivel', () => {
  expect(Object.keys(NIVELES_ESTUDIOS)).toHaveLength(6);
  expect(
    Object.entries(NIVELES_ESTUDIOS)
      .filter(([, v]) => v.archivo === 'obligatorio')
      .map(([k]) => k),
  ).toEqual(['bachiller_exterior', 'decimo_aprobado', 'cursando_bachillerato']);
  expect(NIVELES_ESTUDIOS.bachiller_reciente.archivo).toBe('opcional');
  expect(NIVELES_ESTUDIOS.menos_de_decimo.permitido).toBe(false);
});
// Regla vigente: todos los métodos del catálogo (incluida revision_visual) habilitan la aprobación
// en los niveles permitidos; la seguridad la aporta la revalidación atómica de las últimas
// verificaciones vigentes, no el método. Un nivel bloqueado nunca habilita.
test.each(Object.keys(NIVELES_ESTUDIOS) as NivelEstudios[])(
  'cualquier método habilita la aprobación solo si el nivel %s está permitido',
  (nivel) => {
    for (const tipo of ['identidad', 'estudios'] as const)
      for (const metodo of METODOS_VERIFICACION)
        expect(metodoHabilitaAprobacion(tipo, nivel, metodo)).toBe(
          NIVELES_ESTUDIOS[nivel].permitido,
        );
  },
);
test('revision_visual es un método válido que habilita la aprobación en un nivel permitido', () => {
  expect(METODOS_VERIFICACION).toContain('revision_visual');
  expect(metodoHabilitaAprobacion('estudios', 'bachiller', 'revision_visual')).toBe(true);
  expect(metodoHabilitaAprobacion('identidad', 'decimo_aprobado', 'revision_visual')).toBe(true);
});
test('el web service del Registro Civil está previsto pero no se puede registrar manualmente', () => {
  expect(METODOS_VERIFICACION).toContain('registro_civil_web_service');
  expect(METODOS_MANUALES_VERIFICACION).not.toContain('registro_civil_web_service');
});
test('spam e inconsistencias no envían correo; VENCIDA es interna', () => {
  expect(MOTIVOS_RECHAZO.SPAM.enviarCorreo).toBe(false);
  expect(MOTIVOS_RECHAZO.DATOS_INCONSISTENTES_O_FALSOS.enviarCorreo).toBe(false);
  expect(MOTIVOS_RECHAZO.VENCIDA.enviarCorreo).toBe(false);
});
test('catálogos incluyen desconocimiento de sangre y derivación extranjera; checklist físico no bloquea pago', () => {
  expect(TIPOS_SANGRE).toHaveLength(9);
  expect(TIPOS_SANGRE).toContain('no_sabe');
  expect(NACIONALIDADES).toContain('extranjero_sin_cedula');
  expect(DOCUMENTOS_FISICOS.map((d) => d.bloqueaPago)).toEqual([false, false, false, false]);
});
