// hapagHelper.js

const GCODE_IGST_MAP = {
  G0: 5,
  G1: 12,
  G2: 18,
  G3: 28
};

function isHapagLloydInvoice(fields) {
  const name = fields["SUPPLIER NAME"]?.content?.toLowerCase() || "";
  const gst = fields["SUPPLIER GST"]?.content?.toLowerCase() || "";
  return name.includes("hapag-lloyd") || gst.includes("aaach0979g1z");
}

function getIGSTPercentFromGCode(code) {
  const pct = GCODE_IGST_MAP[code];
  return pct ? `${pct}%` : "";
}

function computeIGSTAmount(rate, percentStr) {
  const percent = parseFloat(percentStr.replace("%", "")) || 0;
  return parseFloat(((rate || 0) * percent / 100).toFixed(2));
}

function applyHapagLloydTaxMapping(lineItemObj) {
  const f = lineItemObj.valueObject || {};
  const gCode = f["TAX"]?.content?.trim() || "";
  const rate = parseFloat((f["RATE"]?.valueString ?? f["RATE"]?.content ?? "0").replace(/,/g, ""));
  const igstPercent = getIGSTPercentFromGCode(gCode);
  const igstAmount = computeIGSTAmount(rate, igstPercent);

  return {
    ...f,
    "IGST %": { content: igstPercent },
    "IGST_AMOUNT": { content: igstAmount.toString() }
  };
}

module.exports = {
  isHapagLloydInvoice,
  applyHapagLloydTaxMapping
};