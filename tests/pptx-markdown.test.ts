/**
 * PowerPoint decks in (owner, 2026-11-15: "make sure it can ingest the modules pptx properly"): convertPptx /
 * joinSlides on a real zip built by tests/helpers/tiny-pptx.ts, the read tool on a .pptx path (chat
 * attachments), and the notes import route (the knowledge graph).
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

import { convertPptx, joinSlides, looksLikePptx } from "../src/agent/subagents/pptx-markdown.ts";
import { createReadTool } from "../src/agent/tools/read.ts";
import { POST } from "../app/api/graph/import/route.ts";
import { extraction } from "../src/server/index.ts";
import { textBox, tinyPptx } from "./helpers/tiny-pptx.ts";

const EQUATION = `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="a14"><p:sp><p:nvSpPr><p:cNvPr id="5" name="Eq"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:txBody><a:p><a14:m xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"><m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:oMath><m:r><m:t>V = IR</m:t></m:r></m:oMath></m:oMathPara></a14:m></a:p></p:txBody></p:sp></mc:Choice><mc:Fallback><p:sp><p:txBody><a:p><a:r><a:t>V = IR (picture)</a:t></a:r></a:p></p:txBody></p:sp><p:pic/></mc:Fallback></mc:AlternateContent>`;
const TABLE = `<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Range</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Max &amp; min sensed</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;

const deck = tinyPptx([
	{ title: "Sensors", body: textBox("A sensor converts a physical event", "into an electrical signal."), notes: "Ask for an everyday example." },
	{ title: "Ohm's law", body: EQUATION + TABLE + `<p:pic><p:nvPicPr><p:cNvPr id="7" name="Diagram"/></p:nvPicPr></p:pic>` },
	{ body: textBox("Selection criteria", "Range, resolution, accuracy") },
	{ title: "Backup slide", body: textBox("Only for questions"), hidden: true },
]);

describe("PowerPoint decks", () => {
	it("reads the slides in the deck's own order, with titles, text, tables, equations once, pictures and notes", () => {
		const d = convertPptx(deck);
		assert.equal(d.kind, "converted");
		if (d.kind !== "converted") return;
		assert.deepEqual(d.slides.map((s) => [s.number, s.title, s.lines, s.notes, s.pictures, s.hidden]), [
			[1, "Sensors", ["A sensor converts a physical event", "into an electrical signal."], ["Ask for an everyday example."], 0, false],
			[2, "Ohm's law", ["V = IR", "Range", "Max & min sensed"], [], 1, false],
			[3, "Selection criteria", ["Range, resolution, accuracy"], [], 0, false],
			[4, "Backup slide", ["Only for questions"], [], 0, true],
		]);
	});

	it("joins them into slide-marked Markdown that says what only a picture shows", () => {
		const d = convertPptx(deck);
		assert.ok(d.kind === "converted");
		const md = joinSlides(d.slides);
		assert.match(md, /^## Slide 1 — Sensors\n\nA sensor converts/);
		assert.match(md, /## Slide 2 — Ohm's law\n\nV = IR\n\nRange\n\nMax & min sensed\n\n\*\(1 picture on this slide/);
		assert.match(md, /> Speaker notes: Ask for an everyday example\./);
		assert.match(md, /## Slide 4 — Backup slide \(hidden slide\)/);
		assert.doesNotMatch(md, /\(picture\)/, "an equation's fallback picture is not read as more text");
	});

	it("refuses what is not a deck without throwing", () => {
		assert.equal(convertPptx(new TextEncoder().encode("plain words")).kind, "unreadable");
		assert.equal(convertPptx(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0])).kind, "unreadable");
		assert.ok(looksLikePptx("Module 2 PPT.PPTX", new Uint8Array()));
		assert.ok(looksLikePptx("download", deck));
		assert.ok(!looksLikePptx("notes.txt", new TextEncoder().encode("hello")));
	});

	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-pptx-"));
	after(() => fs.rmSync(dir, { recursive: true, force: true }));

	it("the read tool reads an attached .pptx as its slides' text (it was refused as binary)", async () => {
		const file = path.join(dir, "AP - Module 4.pptx");
		fs.writeFileSync(file, deck);
		const out = await createReadTool().execute("t1", { path: file }, undefined as never);
		const text = JSON.stringify(out);
		assert.match(text, /PowerPoint '.*AP - Module 4\.pptx': 4 slides, text extracted in slide order/);
		assert.match(text, /Slide 2 — Ohm's law/);
		assert.doesNotMatch(text, /appears to be binary/);
	});

	it("the notes import takes a .pptx into the knowledge graph as slide-marked Markdown", async () => {
		const received: string[] = [];
		const real = extraction.importNotes;
		extraction.importNotes = async ({ text }) => { received.push(text); return { nodes: 0, chains: 0 }; };
		try {
			const form = new FormData();
			form.append("files", new File([deck], "Module 3 PPT.pptx"));
			const res = await POST(new Request("http://localhost/api/graph/import", { method: "POST", body: form }));
			const { results } = await res.json();
			assert.equal(results[0].outcome, "completed", JSON.stringify(results[0]));
			assert.match(results[0].notice ?? "", /1 picture in this deck was not read/);
			assert.match(received[0] ?? "", /^## Slide 1 — Sensors/);
		} finally { extraction.importNotes = real; }
	});
});
