import sharp from 'sharp';
import { prepareCertificate } from '../../src/utils/certificateFile';
import { hugePng, jpeg, pdf, png } from '../helpers/hostileFiles';

const run = (buffer: Buffer, name = 'cert.jpg', mimetype = 'image/jpeg') =>
  prepareCertificate({ buffer, originalname: name, mimetype });
const code = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => 'OK',
    (e: unknown) => (e as { code?: string }).code,
  );

describe('imágenes', () => {
  it('recodifica a JPEG y elimina EXIF/GPS', async () => {
    const source = await jpeg(40, 20, {
      exif: { IFD0: { ImageDescription: 'posicion-secreta' }, IFD3: { GPSLatitudeRef: 'S' } },
    });
    expect((await sharp(source).metadata()).exif).toBeDefined();
    const result = await run(source);
    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
    expect(result.buffer.includes(Buffer.from('posicion-secreta'))).toBe(false);
    expect(result).toMatchObject({ mime: 'image/jpeg', extension: 'jpg' });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.size).toBe(result.buffer.length);
  });
  it('aplica la orientación antes de descartarla', async () => {
    const result = await run(await jpeg(40, 20, { orientation: 6 }));
    const meta = await sharp(result.buffer).metadata();
    expect([meta.width, meta.height]).toEqual([20, 40]);
  });
  it('acota el lado mayor a 2000 px sin ampliar', async () => {
    const big = await run(await jpeg(3000, 1000));
    expect((await sharp(big.buffer).metadata()).width).toBe(2000);
    const small = await run(await jpeg(300, 100));
    expect((await sharp(small.buffer).metadata()).width).toBe(300);
  });
  it('convierte PNG con transparencia a JPEG sobre fondo blanco', async () => {
    const result = await run(await png(20, 20, true), 'foto.PNG', 'image/png');
    expect(result.mime).toBe('image/jpeg');
    expect((await sharp(result.buffer).metadata()).hasAlpha).toBe(false);
  });
  it('descarta HTML u otros datos pegados tras un JPEG', async () => {
    const payload = Buffer.from('<html><script>alert(1)</script></html>');
    const result = await run(Buffer.concat([await jpeg(), payload]));
    expect(result.buffer.includes(payload)).toBe(false);
  });
  it('rechaza una imagen con dimensiones enormes y pocos bytes', async () => {
    const bomb = hugePng();
    expect(bomb.length).toBeLessThan(200);
    expect(await code(run(bomb, 'a.png', 'image/png'))).toBe('ARCHIVO_INVALIDO');
  });
  it('rechaza una cabecera JPEG sin imagen decodificable', async () => {
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
    expect(await code(run(fake))).toBe('ARCHIVO_INVALIDO');
  });
});

describe('tipo y tamaño', () => {
  it.each([
    [
      'SVG',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
      'a.svg',
      'image/svg+xml',
    ],
    ['WebP', Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1'), 'a.webp', 'image/webp'],
    ['HEIC', Buffer.from('\u0000\u0000\u0000\u0018ftypheic', 'latin1'), 'a.heic', 'image/heic'],
    ['ZIP', Buffer.from('PK\u0003\u0004rest', 'latin1'), 'a.zip', 'application/zip'],
    ['ejecutable', Buffer.from('MZ\u0090\u0000', 'latin1'), 'a.exe', 'application/x-msdownload'],
  ])('rechaza %s por su firma real', async (_n, buffer, name, mime) => {
    expect(await code(run(buffer, name, mime))).toBe('ARCHIVO_TIPO_NO_PERMITIDO');
  });
  it('rechaza ejecutable que se hace pasar por JPG', async () => {
    expect(await code(run(Buffer.from('MZ\u0090\u0000', 'latin1')))).toBe(
      'ARCHIVO_TIPO_NO_PERMITIDO',
    );
  });
  it('rechaza desajuste entre extensión, MIME y contenido', async () => {
    const image = await png();
    expect(await code(run(image, 'a.jpg', 'image/jpeg'))).toBe('ARCHIVO_INVALIDO');
    expect(await code(run(image, 'a.png', 'image/jpeg'))).toBe('ARCHIVO_INVALIDO');
    expect(await code(run(pdf(), 'a.jpg', 'application/pdf'))).toBe('ARCHIVO_INVALIDO');
    expect(await code(run(await jpeg(), 'sin-extension', 'image/jpeg'))).toBe('ARCHIVO_INVALIDO');
  });
  it('rechaza archivos vacíos y mayores a 2 MiB', async () => {
    expect(await code(run(Buffer.alloc(0)))).toBe('ARCHIVO_INVALIDO');
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2 * 1024 * 1024)]);
    expect(await code(run(big, 'a.pdf', 'application/pdf'))).toBe('ARCHIVO_DEMASIADO_GRANDE');
  });
  it('acepta un PDF válido sin modificarlo', async () => {
    const source = pdf();
    const result = await run(source, 'a.pdf', 'application/pdf');
    expect(result.buffer).toBe(source);
    expect(result).toMatchObject({ mime: 'application/pdf', extension: 'pdf' });
  });
  it('rechaza un PDF activo', async () => {
    expect(
      await code(run(pdf('/OpenAction << /S /JavaScript >>'), 'a.pdf', 'application/pdf')),
    ).toBe('ARCHIVO_INVALIDO');
  });
});
