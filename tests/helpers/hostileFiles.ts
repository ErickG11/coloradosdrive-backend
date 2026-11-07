import { deflateSync } from 'node:zlib';
import sharp from 'sharp';

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Archivos de prueba generados por código; ninguno contiene datos reales.
export async function jpeg(
  width = 40,
  height = 20,
  extra: Record<string, unknown> = {},
): Promise<Buffer> {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } },
  });
  return image.jpeg({ quality: 90 }).withMetadata(extra).toBuffer();
}
export async function png(width = 40, height = 20, alpha = false): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: alpha ? 4 : 3,
      background: { r: 10, g: 120, b: 200, alpha: alpha ? 0.3 : 1 },
    },
  })
    .png()
    .toBuffer();
}
// PNG válido de pocos bytes que declara dimensiones enormes (bomba de descompresión).
export function hugePng(width = 30000, height = 30000): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc(16))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function pdf(body = '', pages = 1, trailer = '%%EOF'): Buffer {
  const kids = Array.from({ length: pages }, (_v, i) => `${String(10 + i)} 0 R`).join(' ');
  const objects = Array.from(
    { length: pages },
    (_v, i) => `${String(10 + i)} 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n`,
  ).join('');
  return Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R ${body} >>\nendobj\n` +
      `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${String(pages)} >>\nendobj\n${objects}` +
      `trailer\n<< /Root 1 0 R >>\n${trailer}\n`,
    'latin1',
  );
}
export function pdfWithObjectStream(inner: string): Buffer {
  const data = deflateSync(Buffer.from(inner, 'latin1'));
  return Buffer.concat([
    Buffer.from(
      `%PDF-1.5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n` +
        `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n` +
        `4 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${String(data.length)} >>\nstream\n`,
      'latin1',
    ),
    data,
    Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'),
  ]);
}
