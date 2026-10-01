import { applyVotingExemption, normalizeDocuments, validateDocumentUpdates,
  validateInitialPayment } from '../../src/utils/manualEnrollmentDetails';

describe('checklist de matrícula', () => {
  it('completa el catálogo cerrado con pendientes y rechaza repetidos o tipos ajenos', () => {
    expect(normalizeDocuments([{ tipo: 'cedula', estado: 'entregado' }])).toEqual([
      { tipo: 'cedula', estado: 'entregado' },
      { tipo: 'papeleta_votacion', estado: 'pendiente' },
      { tipo: 'tipo_sangre', estado: 'pendiente' },
      { tipo: 'titulo_bachiller', estado: 'pendiente' },
    ]);
    expect(() => validateDocumentUpdates([
      { tipo: 'cedula', estado: 'pendiente' },
      { tipo: 'cedula', estado: 'entregado' },
    ])).toThrow('repetidos');
    expect(() => validateDocumentUpdates([
      { tipo: 'otro' as 'cedula', estado: 'pendiente' },
    ])).toThrow('inválidos');
    expect(() => validateDocumentUpdates([null as unknown as { tipo: 'cedula'; estado: 'pendiente' }]))
      .toThrow('inválidos');
  });

  it('exime la papeleta desde el cumpleaños 65; sin fecha queda pendiente y editable', () => {
    const documents = normalizeDocuments();
    expect(applyVotingExemption(documents, '1961-10-01', '2026-09-30')[1].estado)
      .toBe('pendiente');
    expect(applyVotingExemption(documents, '1961-09-30', '2026-09-30')[1].estado)
      .toBe('no_aplica');
    expect(applyVotingExemption(documents, null, '2026-09-30')[1].estado)
      .toBe('pendiente');
    expect(validateDocumentUpdates([{ tipo: 'papeleta_votacion', estado: 'entregado' }]))
      .toHaveLength(1);
  });
});

describe('abono inicial', () => {
  it('conserva monto_total neto y valida abono parcial o pago completo', () => {
    expect(validateInitialPayment(150, { modalidad: 'abono', descuento: 50,
      montoAbonado: 30 })).toBe(100);
    expect(validateInitialPayment(150, { modalidad: 'completo', descuento: 50,
      montoAbonado: 100 })).toBe(100);
    expect(() => validateInitialPayment(150, { modalidad: 'completo', descuento: 50,
      montoAbonado: 99 })).toThrow('igualar');
    expect(() => validateInitialPayment(150, { modalidad: 'abono', descuento: 151,
      montoAbonado: 0 })).toThrow('descuento');
    expect(() => validateInitialPayment(150, { modalidad: 'abono', descuento: 0,
      montoAbonado: 151 })).toThrow('superar');
    expect(() => validateInitialPayment(150, { modalidad: 'abono', descuento: 0,
      montoAbonado: 1.001 })).toThrow('dos decimales');
  });

  it('sin cohorte admite abono sin tope, con descuento cero y saldo desconocido', () => {
    expect(validateInitialPayment(null, { modalidad: 'abono', descuento: 0,
      montoAbonado: 500 })).toBeNull();
    expect(() => validateInitialPayment(null, { modalidad: 'abono', descuento: 1,
      montoAbonado: 0 })).toThrow('descuento cero');
    expect(() => validateInitialPayment(null, { modalidad: 'completo', descuento: 0,
      montoAbonado: 0 })).toThrow('solo se permite');
  });
});
