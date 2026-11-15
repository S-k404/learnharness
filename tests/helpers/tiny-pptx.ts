import { deflateRawSync } from "node:zlib";

/**
 * A minimal but real .pptx for tests: a zip (one deflated, one stored entry kind) holding presentation.xml, its
 * relationships, and the given slides with optional speaker notes. Slides are listed in presentation.xml in the
 * order given while their part files are numbered in reverse, so a reader that sorts by file name gets them wrong.
 */
export interface TinySlide {
	title?: string;
	/** Raw shape XML inside <p:spTree> after the title (text boxes, tables, pictures, equations). */
	body?: string;
	notes?: string;
	hidden?: boolean;
}

const NS = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A text box shape holding these paragraphs. */
export function textBox(...paragraphs: string[]): string {
	return `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Text"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:txBody>${paragraphs.map((t) => `<a:p><a:r><a:t>${esc(t)}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp>`;
}

function crc32(data: Uint8Array): number {
	let c = ~0;
	for (const byte of data) { c ^= byte; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
	return ~c >>> 0;
}

function zip(files: Array<[string, string]>): Uint8Array<ArrayBuffer> {
	const locals: Buffer[] = [], centrals: Buffer[] = [];
	let offset = 0;
	files.forEach(([name, text], i) => {
		const raw = Buffer.from(text, "utf8"), stored = i % 2 === 1;
		const data = stored ? raw : deflateRawSync(raw);
		const n = Buffer.from(name, "utf8");
		const head = Buffer.alloc(30);
		head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(stored ? 0 : 8, 8);
		head.writeUInt32LE(crc32(raw), 14); head.writeUInt32LE(data.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(n.length, 26);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(stored ? 0 : 8, 10);
		central.writeUInt32LE(crc32(raw), 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(n.length, 28);
		central.writeUInt32LE(offset, 42);
		locals.push(head, n, data); centrals.push(central, n);
		offset += head.length + n.length + data.length;
	});
	const dir = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
	end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
	const out = Buffer.concat([...locals, dir, end]);
	return new Uint8Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)) as Uint8Array<ArrayBuffer>;
}

export function tinyPptx(slides: TinySlide[]): Uint8Array<ArrayBuffer> {
	const files: Array<[string, string]> = [];
	const ids = slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join("");
	files.push(["ppt/presentation.xml", `<?xml version="1.0" encoding="UTF-8"?><p:presentation ${NS}><p:sldIdLst>${ids}</p:sldIdLst></p:presentation>`]);
	const part = (i: number) => slides.length - i;   // listed first, numbered last
	files.push(["ppt/_rels/presentation.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides.map((_, i) => `<Relationship Target="slides/slide${part(i)}.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Id="rId${i + 1}"/>`).join("")}</Relationships>`]);
	slides.forEach((s, i) => {
		const title = s.title ? `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${esc(s.title)}</a:t></a:r></a:p></p:txBody></p:sp>` : "";
		const number = `<p:sp><p:nvSpPr><p:cNvPr id="9" name="Slide Number"/><p:cNvSpPr/><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${i + 1}</a:t></a:r></a:p></p:txBody></p:sp>`;
		files.push([`ppt/slides/slide${part(i)}.xml`, `<?xml version="1.0"?><p:sld ${NS}${s.hidden ? ` show="0"` : ""}><p:cSld><p:spTree>${title}${s.body ?? ""}${number}</p:spTree></p:cSld></p:sld>`]);
		if (s.notes) {
			files.push([`ppt/slides/_rels/slide${part(i)}.xml.rels`, `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${i + 1}.xml"/></Relationships>`]);
			files.push([`ppt/notesSlides/notesSlide${i + 1}.xml`, `<?xml version="1.0"?><p:notes ${NS}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${esc(s.notes)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`]);
		}
	});
	return zip(files);
}
