import { deflateSync } from 'node:zlib';
import { inspectPdf } from '../../src/utils/pdfInspection';
import { pdf, pdfWithObjectStream } from '../helpers/hostileFiles';

const rejected = (buffer: Buffer): boolean => {
  try {
    inspectPdf(buffer);
    return false;
  } catch (e) {
    return (e as { code?: string }).code === 'ARCHIVO_INVALIDO';
  }
};

it('acepta un PDF simple y cuenta sus páginas', () => {
  expect(inspectPdf(pdf('', 3))).toEqual({ paginas: 3 });
});
it.each([
  'JavaScript',
  'JS',
  'OpenAction',
  'AA',
  'Launch',
  'EmbeddedFile',
  'RichMedia',
  'XFA',
  'SubmitForm',
  'GoToR',
])('rechaza /%s', (name) => {
  expect(rejected(pdf(`/${name} 5 0 R`))).toBe(true);
});
it('rechaza nombres escapados en hexadecimal', () => {
  expect(rejected(pdf('/J#61vaScript 5 0 R'))).toBe(true);
  expect(rejected(pdf('/#4F#70enAction 5 0 R'))).toBe(true);
  expect(rejected(pdf('/#4A#53 (alert(1))'))).toBe(true);
});
it('no confunde nombres que solo comienzan igual', () => {
  expect(rejected(pdf('/JSON 1 /AAA 2 /Launcher 3'))).toBe(false);
});
it('rechaza acciones escondidas en objetos comprimidos', () => {
  expect(rejected(pdfWithObjectStream('<< /S /JavaScript /JS (x) >>'))).toBe(true);
  expect(rejected(pdfWithObjectStream('<< /S /J#61vaScript >>'))).toBe(true);
  expect(rejected(pdfWithObjectStream('<< /Foo /Bar >>'))).toBe(false);
});
it('falla cerrado ante objetos comprimidos que no se pueden inflar o con otros filtros', () => {
  const broken = pdfWithObjectStream('<< /A /B >>')
    .toString('latin1')
    .replace('/FlateDecode', '/LZWDecode');
  expect(rejected(Buffer.from(broken, 'latin1'))).toBe(true);
  const garbage = Buffer.from(
    pdfWithObjectStream('<< /A /B >>')
      .toString('latin1')
      .replace(/stream\n[\s\S]*\nendstream/, 'stream\nnot-zlib\nendstream'),
    'latin1',
  );
  expect(rejected(garbage)).toBe(true);
});
it('rechaza una bomba de inflado', () => {
  const bomb = deflateSync(Buffer.alloc(20 * 1024 * 1024, 0x20));
  expect(bomb.length).toBeLessThan(100 * 1024);
  const text = pdfWithObjectStream('x').toString('latin1');
  const start = text.indexOf('stream\n') + 7;
  const end = text.indexOf('\nendstream');
  expect(
    rejected(
      Buffer.concat([
        Buffer.from(text.slice(0, start), 'latin1'),
        bomb,
        Buffer.from(text.slice(end), 'latin1'),
      ]),
    ),
  ).toBe(true);
});
it('ignora bytes binarios dentro de flujos corrientes', () => {
  const buffer = Buffer.concat([
    pdf().subarray(0, 40),
    Buffer.from(
      '3 0 obj\n<< /Length 9 >>\nstream\n/JS /AA /Launch\nendstream\nendobj\n/Type /Page\n%%EOF\n',
      'latin1',
    ),
  ]);
  expect(inspectPdf(buffer).paginas).toBe(1);
});
it('rechaza PDFs sin firma, sin %%EOF final, truncados, cifrados o con demasiadas páginas', () => {
  expect(rejected(Buffer.from('%PDX-1.4\n/Type /Page\n%%EOF'))).toBe(true);
  expect(rejected(pdf('', 1, 'sin fin'))).toBe(true);
  expect(rejected(Buffer.from('%PDF-1.4\n1 0 obj\n<< >>\nstream\nabc\n%%EOF'))).toBe(true);
  expect(rejected(pdf('/Encrypt 9 0 R'))).toBe(true);
  expect(rejected(pdf('', 11))).toBe(true);
  expect(rejected(pdf('', 10))).toBe(false);
  expect(rejected(Buffer.from('%PDF-1.4\n%%EOF'))).toBe(true);
});
it('solo busca %%EOF en el último kilobyte', () => {
  const relleno = Buffer.concat([pdf('', 1, ''), Buffer.alloc(2000, 0x20)]);
  expect(rejected(Buffer.concat([Buffer.from('%%EOF\n'), relleno]))).toBe(true);
});
