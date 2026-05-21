function pdfEscape(input) {
  return String(input ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapText(input, maxChars = 86) {
  const text = String(input ?? "").trim();
  if (!text) return [""];
  const words = text.split(/\s+/);
  const out = [];
  let line = "";
  for (const w of words) {
    if (!line) {
      line = w;
      continue;
    }
    if ((line + " " + w).length > maxChars) {
      out.push(line);
      line = w;
    } else {
      line += ` ${w}`;
    }
  }
  if (line) out.push(line);
  return out;
}

function buildContentStream(title, bodyLines) {
  const lines = [];
  lines.push("BT");
  lines.push("/F1 18 Tf");
  lines.push(`1 0 0 1 50 790 Tm (${pdfEscape(title)}) Tj`);
  lines.push("/F1 12 Tf");
  let y = 760;
  for (const raw of bodyLines) {
    if (y < 52) break;
    const wrapped = wrapText(raw);
    for (const w of wrapped) {
      if (y < 52) break;
      lines.push(`1 0 0 1 50 ${y} Tm (${pdfEscape(w)}) Tj`);
      y -= 18;
    }
  }
  lines.push("ET");
  return `${lines.join("\n")}\n`;
}

export function buildReceiptPdfBuffer({ title, bodyLines }) {
  const stream = buildContentStream(title, bodyLines);

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}endstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}
