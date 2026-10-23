import { crc32 } from "node:zlib";

/**
 * A small store-only (no compression) zip writer that streams: each entry is written with a data
 * descriptor (general-purpose flag bit 3), so its CRC and size are known only after its bytes have gone
 * out, and nothing is buffered beyond one chunk. The archive is never stored (#146). No zip64: the caller
 * keeps the total under `ZIP_MAX_TOTAL_BYTES` and the entries at 500 or fewer.
 */

/** Total entry bytes above which `createZipStream` is not used: offsets and sizes must fit in 32 bits. */
export const ZIP_MAX_TOTAL_BYTES = 4_000_000_000;

export interface ZipEntry {
  /** The name inside the archive (UTF-8); a plain file name, never a path. */
  name: string;
  /** Opens the entry's bytes. Called once, when the archive reaches this entry. */
  open: () => Promise<ReadableStream<Uint8Array>>;
}

const FLAGS = 0x0808; // bit 3: data descriptor follows; bit 11: names are UTF-8

/** MS-DOS time and date fields for a Date (local fields are fine; zip has no zone). */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

function localHeader(nameBytes: Uint8Array, stamp: { time: number; date: number }): Uint8Array {
  const buf = new Uint8Array(30 + nameBytes.length);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true); // version needed
  view.setUint16(6, FLAGS, true);
  view.setUint16(8, 0, true); // method: store
  view.setUint16(10, stamp.time, true);
  view.setUint16(12, stamp.date, true);
  // crc32, compressed size, uncompressed size stay 0: they follow in the data descriptor.
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, 0, true); // extra length
  buf.set(nameBytes, 30);
  return buf;
}

function dataDescriptor(crc: number, size: number): Uint8Array {
  const buf = new Uint8Array(16);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 0x08074b50, true);
  view.setUint32(4, crc, true);
  view.setUint32(8, size, true); // compressed size (stored: equal)
  view.setUint32(12, size, true);
  return buf;
}

interface Written {
  nameBytes: Uint8Array;
  crc: number;
  size: number;
  offset: number;
}

function centralDirectory(written: Written[], stamp: { time: number; date: number }, offset: number): Uint8Array[] {
  const parts: Uint8Array[] = [];
  let size = 0;
  for (const entry of written) {
    const buf = new Uint8Array(46 + entry.nameBytes.length);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true); // version made by
    view.setUint16(6, 20, true); // version needed
    view.setUint16(8, FLAGS, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, stamp.time, true);
    view.setUint16(14, stamp.date, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.size, true);
    view.setUint32(24, entry.size, true);
    view.setUint16(28, entry.nameBytes.length, true);
    view.setUint32(42, entry.offset, true);
    buf.set(entry.nameBytes, 46);
    parts.push(buf);
    size += buf.length;
  }
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, written.length, true);
  view.setUint16(10, written.length, true);
  view.setUint32(12, size, true);
  view.setUint32(16, offset, true);
  parts.push(end);
  return parts;
}

async function* zipChunks(entries: ZipEntry[], now: Date): AsyncGenerator<Uint8Array> {
  const stamp = dosDateTime(now);
  const encoder = new TextEncoder();
  const written: Written[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const header = localHeader(nameBytes, stamp);
    const start = offset;
    yield header;
    offset += header.length;

    const reader = (await entry.open()).getReader();
    let crc = 0;
    let size = 0;
    let finished = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          finished = true;
          break;
        }
        if (value.byteLength === 0) continue;
        crc = crc32(value, crc);
        size += value.byteLength;
        offset += value.byteLength;
        yield value;
      }
    } finally {
      // A consumer that stops early (or a failure) must not leave the source download running.
      if (!finished) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    const descriptor = dataDescriptor(crc, size);
    yield descriptor;
    offset += descriptor.length;
    written.push({ nameBytes, crc, size, offset: start });
  }

  for (const part of centralDirectory(written, stamp, offset)) yield part;
}

/** The archive as a pull-driven stream: the next chunk is read from the source only when the consumer asks. */
export function createZipStream(entries: ZipEntry[], now: Date = new Date()): ReadableStream<Uint8Array> {
  const chunks = zipChunks(entries, now);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await chunks.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
}
