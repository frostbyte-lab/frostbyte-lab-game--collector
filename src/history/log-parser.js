/** Parse browser/collector error logs into history-ready records. */
export function parseLogText(raw) {
  const text = String(raw || "").replace(/\r\n?/g, "\n").trim();
  const pick = (label) => {
    const match = text.match(new RegExp("^" + label + ":\\s*(.*)$", "im"));
    return match ? match[1].trim() : null;
  };
  const errorStart = text.search(/^Error:\s*/im);
  const errorText = errorStart >= 0 ? text.slice(errorStart).replace(/^Error:\s*/i, "").trim() : "";
  const blocks = [];
  const pattern = /(?:^|\n)\s*(\d+)\)\s*([^\n]*)([\s\S]*?)(?=\n\s*\d+\)\s|$)/g;
  let match;
  while ((match = pattern.exec(errorText))) blocks.push({ index: Number(match[1]), title: match[2].trim(), detail: match[3].trim() });
  if (!blocks.length && errorText) blocks.push({ index: 1, title: errorText.split("\n")[0], detail: errorText });
  return { ip: pick("IP"), page: pick("Page"), errorCode: pick("Error code"), time: pick("Time"), userAgent: pick("UA"), errors: blocks, raw: text };
}
