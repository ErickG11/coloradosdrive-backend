import {
  dollarsToCentavos,
  formatCell,
  formatCentavos,
  formatDecimal,
  formatPercent,
  neutralizeFormula,
  ratio,
  reportFileName,
  safeSheetName,
} from '../../src/utils/reportFormat';

describe('RF-08 · conversión de moneda sin punto flotante', () => {
  it.each([
    ['150', 15000],
    ['150.00', 15000],
    ['150.5', 15050],
    ['0.10', 10],
    ['0.07', 7],
    ['1234567.89', 123456789],
    ['19.999', 2000],
    ['-5.25', -525],
    [150, 15000],
  ])('convierte %p dólares a %p centavos', (input, expected) => {
    expect(dollarsToCentavos(input)).toBe(expected);
  });

  it.each([null, undefined, '', 'abc', '1,50', '1e3', 'NaN'])('rechaza %p', (input) => {
    expect(dollarsToCentavos(input)).toBeNull();
  });

  it('suma 0,10 + 0,20 exactamente (el caso que falla en punto flotante)', () => {
    const total = (dollarsToCentavos('0.10') ?? 0) + (dollarsToCentavos('0.20') ?? 0);
    expect(total).toBe(30);
    expect(formatCentavos(total)).toBe('$0,30');
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it.each([
    [0, '$0,00'],
    [5, '$0,05'],
    [15000, '$150,00'],
    [123456789, '$1.234.567,89'],
    [-525, '-$5,25'],
  ])('formatea %p centavos como %p', (input, expected) => {
    expect(formatCentavos(input)).toBe(expected);
  });
});

describe('RF-08 · tasas y números', () => {
  it('una tasa con denominador cero es null y se muestra como «—», nunca NaN ni Infinity', () => {
    expect(ratio(0, 0)).toBeNull();
    expect(ratio(5, 0)).toBeNull();
    expect(ratio(1, -1)).toBeNull();
    expect(ratio(Number.NaN, 2)).toBeNull();
    expect(formatPercent(ratio(0, 0))).toBe('—');
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatCell(null, 'percent')).toBe('—');
    expect(formatCell(Number.NaN, 'money')).toBe('—');
  });

  it('formatea porcentajes, decimales y enteros en español', () => {
    expect(formatPercent(ratio(2, 3))).toBe('66,7 %');
    expect(formatPercent(1)).toBe('100,0 %');
    expect(formatDecimal(1234.5)).toBe('1.234,50');
    expect(formatCell(1234, 'integer')).toBe('1.234');
    expect(formatCell('Texto', 'text')).toBe('Texto');
  });
});

describe('RF-08 · neutralización de fórmulas', () => {
  it.each(['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx', '\rx', '=HYPERLINK("http://x","y")'])(
    'neutraliza %p',
    (input) => {
      const output = neutralizeFormula(input);
      expect(output.startsWith("'")).toBe(true);
      expect(output.slice(1)).toBe(input);
    },
  );

  it('no altera texto normal ni con tildes', () => {
    expect(neutralizeFormula('Cohorte Ñandú 2026')).toBe('Cohorte Ñandú 2026');
    expect(neutralizeFormula('a=b')).toBe('a=b');
    expect(neutralizeFormula('—')).toBe('—');
  });

  it('quita caracteres de control que corrompen el archivo', () => {
    expect(neutralizeFormula('a\u0000b\u0007c')).toBe('abc');
  });
});

describe('RF-08 · nombres de hoja y de archivo', () => {
  it('elimina caracteres prohibidos y limita a 31 caracteres', () => {
    expect(safeSheetName('Ingresos: A/B [2026]?*\\')).toBe('Ingresos A B 2026');
    const long = safeSheetName('Un nombre de reporte demasiado largo para una hoja de Excel');
    expect(long.length).toBeLessThanOrEqual(31);
    expect(safeSheetName("'Comillas'")).toBe('Comillas');
    expect(safeSheetName('   ')).toBe('Reporte');
    expect(safeSheetName('[]:')).toBe('Reporte');
  });

  it('evita nombres repetidos sin superar el límite', () => {
    const used = new Set(['Finanzas', 'finanzas (2)']);
    const name = safeSheetName('Finanzas', used);
    expect(name).toBe('Finanzas (3)');
    const long = 'x'.repeat(31);
    const second = safeSheetName(long, new Set([long]));
    expect(second).not.toBe(long);
    expect(second.length).toBeLessThanOrEqual(31);
  });

  it('genera el nombre de archivo solo con valores validados', () => {
    expect(reportFileName('finanzas', '2026-11-01', '2026-11-30', 'pdf')).toBe(
      'reporte-finanzas-2026-11-01_2026-11-30.pdf',
    );
    expect(reportFileName('todos', '2026-01-01', '2026-12-31', 'xlsx')).toBe(
      'reporte-todos-2026-01-01_2026-12-31.xlsx',
    );
    const hostile = reportFileName('../../etc/passwd' as never, '"; rm -rf', '<script>', 'xlsx');
    expect(hostile).toBe('reporte-reporte-inicio_fin.xlsx');
    expect(hostile).toMatch(/^[a-z0-9._-]+$/);
  });
});
