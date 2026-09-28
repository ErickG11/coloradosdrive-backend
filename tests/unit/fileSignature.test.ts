import { detectFileType } from '../../src/utils/fileSignature';

function bytes(...values: number[]): Buffer {
  return Buffer.from(values);
}

describe('detectFileType', () => {
  it('reconoce un JPEG por su firma (FF D8 FF)', () => {
    expect(detectFileType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10))).toBe('image/jpeg');
  });

  it('reconoce un PNG por su firma de 8 bytes', () => {
    expect(detectFileType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00))).toBe(
      'image/png',
    );
  });

  it('reconoce un PDF por "%PDF-"', () => {
    expect(detectFileType(Buffer.from('%PDF-1.7\n...'))).toBe('application/pdf');
  });

  it('rechaza texto plano aunque el nombre/mimetype declarado diga otra cosa', () => {
    expect(detectFileType(Buffer.from('esto no es una imagen real'))).toBeNull();
  });

  it('rechaza un archivo vacío o más corto que cualquier firma', () => {
    expect(detectFileType(Buffer.alloc(0))).toBeNull();
    expect(detectFileType(bytes(0xff, 0xd8))).toBeNull();
  });

  it('rechaza un ejecutable (firma MZ) declarado como imagen', () => {
    expect(detectFileType(bytes(0x4d, 0x5a, 0x90, 0x00))).toBeNull();
  });

  it('no confunde un PNG casi-correcto con un byte de la firma alterado', () => {
    expect(
      detectFileType(bytes(0x89, 0x50, 0x4e, 0x48 /* debería ser 0x47 */, 0x0d, 0x0a, 0x1a, 0x0a)),
    ).toBeNull();
  });
});
