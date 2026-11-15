import { inflateRawSync } from "node:zlib";

/**
 * PowerPoint (.pptx) → Markdown by rule, no model and no dependency (owner, 2026-11-15: "make sure it can
 * ingest the modules pptx properly"). A .pptx is a zip of XML parts: the slides are read in the deck's own
 * order (presentation.xml's slide list, not file names), each slide's text paragraphs, tables and equations
 * (Office Math runs) in document order, its speaker notes, and how many pictures it has, so the reader knows
 * what only an image shows. Serves the read tool (chat attachments) and the notes import (the knowledge graph).
 */

export interface PptxSlide {
	number: number;
	title: string;
	lines: string[];
	notes: string[];
	pictures: number;
	hidden: boolean;
}

export type PptxDeck = { kind: "converted"; slides: PptxSlide[] } | { kind: "unreadable"; reason: string };

/** Larger than any lecture deck's text; a zip that inflates past it is refused (a zip bomb, or not a deck). */
const MAX_INFLATED_BYTES = 256 * 1024 * 1024;

/** The zip's entries by name → their bytes, read on demand. Stored and deflated entries only (what Office writes). */
function readZip(bytes: Uint8Array): Map<string, () => Buffer> {
	const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let eocd = -1;
	for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
		if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
	}
	if (eocd < 0) throw new Error("not a zip file");
	const count = buf.readUInt16LE(eocd + 10);
	let at = buf.readUInt32LE(eocd + 16);
	if (at === 0xffffffff) throw new Error("zip64 decks are not supported");
	const entries = new Map<string, () => Buffer>();
	let budget = MAX_INFLATED_BYTES;
	for (let n = 0; n < count; n++) {
		if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error("damaged zip directory");
		const method = buf.readUInt16LE(at + 10);
		const size = buf.readUInt32LE(at + 20);
		const fullSize = buf.readUInt32LE(at + 24);
		const nameLen = buf.readUInt16LE(at + 28);
		const extraLen = buf.readUInt16LE(at + 30);
		const commentLen = buf.readUInt16LE(at + 32);
		const local = buf.readUInt32LE(at + 42);
		const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
		at += 46 + nameLen + extraLen + commentLen;
		entries.set(name, () => {
			if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`damaged zip entry ${name}`);
			const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
			const raw = buf.subarray(start, start + size);
			if (fullSize > budget) throw new Error("the deck inflates past 256 MB");
			budget -= fullSize;
			if (method === 0) return raw;
			if (method === 8) return inflateRawSync(raw, { maxOutputLength: fullSize + 1024 });
			throw new Error(`zip method ${method} is not supported`);
		});
	}
	return entries;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };
function decode(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
		if (code[0] === "#") {
			const point = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
			return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
		}
		return ENTITIES[code.toLowerCase()] ?? whole;
	});
}

/** An element's attribute, whatever order the attributes come in. */
function attr(tag: string, name: string): string | undefined {
	const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
	return m ? decode(m[1] ?? "") : undefined;
}

/** A part's relationships: Id → target path, resolved against the part's folder. */
function relationships(zip: Map<string, () => Buffer>, part: string): Map<string, string> {
	const folder = part.slice(0, part.lastIndexOf("/") + 1);
	const relsPath = `${folder}_rels/${part.slice(folder.length)}.rels`;
	const read = zip.get(relsPath);
	const out = new Map<string, string>();
	if (!read) return out;
	for (const tag of read().toString("utf8").match(/<Relationship\b[^>]*>/g) ?? []) {
		const id = attr(tag, "Id"), target = attr(tag, "Target");
		if (!id || !target || attr(tag, "TargetMode") === "External") continue;
		const parts = (target.startsWith("/") ? target.slice(1) : folder + target).split("/");
		const resolved: string[] = [];
		for (const p of parts) { if (p === "..") resolved.pop(); else if (p && p !== ".") resolved.push(p); }
		out.set(id, resolved.join("/"));
	}
	return out;
}

/** The text paragraphs of a run of slide XML, in order: text runs, line breaks and tabs, and Office Math runs. */
function paragraphs(xml: string): string[] {
	const out: string[] = [];
	for (const p of xml.match(/<a:p\b[^>]*>[\s\S]*?<\/a:p>/g) ?? []) {
		let line = "";
		for (const m of p.matchAll(/<(a|m):t\b[^>]*>([^<]*)<\/\1:t>|<a:br\b[^>]*\/>|<a:tab\b[^>]*\/>/g)) {
			if (m[0].startsWith("<a:br")) line += "\n";
			else if (m[0].startsWith("<a:tab")) line += "\t";
			else line += decode(m[2] ?? "");
		}
		line = line.replace(/[ \u00a0]+/g, " ").trim();
		if (line) out.push(line);
	}
	return out;
}

/** A slide part, its alternate renderings removed (an equation's mc:Fallback is the same content again, as a picture). */
function primary(xml: string): string {
	return xml.replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, "");
}

/** Shapes of the slide (text boxes, placeholders, tables) as [placeholder type, xml] in document order. */
function shapes(xml: string): Array<{ ph: string | null; xml: string }> {
	const out: Array<{ ph: string | null; xml: string }> = [];
	for (const m of xml.matchAll(/<p:(sp|graphicFrame)\b[\s\S]*?<\/p:\1>/g)) {
		const ph = /<p:ph\b[^>]*>/.exec(m[0]);
		out.push({ ph: ph ? (attr(ph[0], "type") ?? "body") : null, xml: m[0] });
	}
	return out;
}

/** Read a .pptx; never throws. */
export function convertPptx(bytes: Uint8Array): PptxDeck {
	try {
		const zip = readZip(bytes);
		const presentation = zip.get("ppt/presentation.xml");
		if (!presentation) return { kind: "unreadable", reason: "no ppt/presentation.xml: not a PowerPoint deck" };
		const rels = relationships(zip, "ppt/presentation.xml");
		const order = (presentation().toString("utf8").match(/<p:sldId\b[^>]*>/g) ?? [])
			.map((tag) => rels.get(attr(tag, "r:id") ?? ""))
			.filter((p): p is string => Boolean(p && zip.has(p)));
		const slides: PptxSlide[] = order.map((part, i) => {
			const raw = zip.get(part)!().toString("utf8");
			const xml = primary(raw);
			const parts = shapes(xml);
			const titleShape = parts.find((s) => s.ph === "title" || s.ph === "ctrTitle");
			let title = titleShape ? paragraphs(titleShape.xml).join(" ") : "";
			const lines = parts.filter((s) => s !== titleShape && s.ph !== "sldNum" && s.ph !== "dt" && s.ph !== "ftr")
				.flatMap((s) => paragraphs(s.xml));
			// a slide built from plain text boxes (no title placeholder): its short first line is its heading
			const first = lines[0];
			if (!title && first !== undefined && lines.length > 1 && first.length <= 80 && !first.includes("\n")) title = lines.shift() ?? "";
			const notesPart = [...relationships(zip, part).values()].find((p) => /notesSlides\/notesSlide\d+\.xml$/.test(p));
			const notesXml = notesPart && zip.get(notesPart) ? primary(zip.get(notesPart)!().toString("utf8")) : "";
			const notes = shapes(notesXml).filter((s) => s.ph === "body").flatMap((s) => paragraphs(s.xml));
			const pictures = (xml.match(/<p:pic\b/g) ?? []).length;
			const hidden = /<p:sld\b[^>]*\sshow="0"/.test(raw);
			return { number: i + 1, title, lines, notes, pictures, hidden };
		});
		return { kind: "converted", slides };
	} catch (err) {
		return { kind: "unreadable", reason: err instanceof Error ? err.message : String(err) };
	}
}

/** The deck as Markdown: one "## Slide N — title" section per slide, its text, a note of its pictures, its speaker notes. */
export function joinSlides(slides: readonly PptxSlide[]): string {
	return slides
		.filter((s) => s.title || s.lines.length || s.notes.length || s.pictures)
		.map((s) => {
			const head = `## Slide ${s.number}${s.title ? ` — ${s.title}` : ""}${s.hidden ? " (hidden slide)" : ""}`;
			const body = s.lines.map((l) => l.replace(/\n/g, "  \n"));
			if (s.pictures) body.push(`*(${s.pictures} ${s.pictures === 1 ? "picture" : "pictures"} on this slide: what only an image shows, such as a diagram or a pasted equation, is not in this text)*`);
			if (s.notes.length) body.push(`> Speaker notes: ${s.notes.join(" ")}`);
			return [head, ...body].join("\n\n");
		})
		.join("\n\n");
}

/** True for a .pptx by name, or a zip whose first entry names the presentation part. */
export function looksLikePptx(name: string, bytes: Uint8Array): boolean {
	if (/\.pptx$/i.test(name)) return true;
	return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && Buffer.from(bytes.subarray(0, 2048)).toString("latin1").includes("ppt/");
}
