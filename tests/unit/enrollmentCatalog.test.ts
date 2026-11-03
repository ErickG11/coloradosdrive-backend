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
test.each(Object.keys(NIVELES_ESTUDIOS) as NivelEstudios[])(
  'revision_visual jamás aprueba %s',
  (nivel) => {
    expect(metodoHabilitaAprobacion('identidad', nivel, 'revision_visual')).toBe(false);
    expect(metodoHabilitaAprobacion('estudios', nivel, 'revision_visual')).toBe(false);
  },
);
test.each(['bachiller', 'bachiller_reciente', 'bachiller_exterior'] as const)(
  'bachiller %s requiere Ministerio',
  (nivel) => {
    for (const metodo of METODOS_VERIFICACION)
      expect(metodoHabilitaAprobacion('estudios', nivel, metodo)).toBe(
        metodo === 'ministerio_portal',
      );
  },
);
test.each(['decimo_aprobado', 'cursando_bachillerato'] as const)(
  'certificado %s requiere fuente distinta de revisión visual',
  (nivel) => {
    for (const metodo of METODOS_VERIFICACION)
      expect(metodoHabilitaAprobacion('estudios', nivel, metodo)).toBe(
        ['codigo_qr_certificado', 'llamada_institucion', 'original_presencial'].includes(metodo),
      );
  },
);
test('identidad solo Registro Civil; web service está previsto pero no habilitado manualmente', () => {
  for (const metodo of METODOS_VERIFICACION)
    expect(metodoHabilitaAprobacion('identidad', 'bachiller', metodo)).toBe(
      metodo.startsWith('registro_civil_'),
    );
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
