/** Extract text only. No HTML, embedded objects, relationship targets or macros run. */
export async function readExternalNoteFile(file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error("External note files must be smaller than 10 MiB.");
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (["md", "markdown", "txt"].includes(extension || "")) {
    const content = await file.text(); if (content.length > 2_000_000 || content.includes("\0")) throw new Error("The note text is too large or invalid."); return content;
  }
  if (extension !== "docx") throw new Error("Choose a Markdown, text, or DOCX note.");
  const { unzipSync } = await import("fflate");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const files = unzipSync(bytes, { filter: (entry) => entry.name === "word/document.xml" && entry.originalSize <= 4 * 1024 * 1024 });
  const documentXml = files["word/document.xml"];
  if (!documentXml || documentXml.byteLength > 4 * 1024 * 1024) throw new Error("The DOCX document is missing or too large.");
  const document = new DOMParser().parseFromString(new TextDecoder().decode(documentXml), "application/xml");
  if (document.getElementsByTagName("parsererror").length) throw new Error("The DOCX XML cannot be read.");
  const namespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const paragraphs = Array.from(document.getElementsByTagNameNS(namespace, "p"));
  const content = paragraphs.map((paragraph) => Array.from(paragraph.getElementsByTagNameNS(namespace, "t")).map((node) => node.textContent || "").join("")).join("\n\n");
  if (!content.trim() || content.length > 2_000_000) throw new Error("The DOCX note is empty or too large.");
  return content;
}
