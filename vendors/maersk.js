// vendors/maersk.js
const { parseAmount, parsePercent, getFirst } = require("../helpers/common");

// Maersk/MSC often already expose TAXABLE AMOUNT + % + amounts. Keep flexible like CMA.
function mapLineItem(line) {
  const f = line.valueObject || {};

  const taxable = parseAmount(getFirst(f, ["TAXABLE AMOUNT","TAXABLE_AMOUNT","AMOUNT","VALUE"]));
  const igstPct = parsePercent(getFirst(f, ["IGST %","IGST%"]));
  const cgstPct = parsePercent(getFirst(f, ["CGST %","CGST%"]));
  const sgstPct = parsePercent(getFirst(f, ["SGST %","SGST%"]));

  let igstAmt = parseAmount(getFirst(f, ["IGST_AMOUNT","IGST AMOUNT","IGST"]));
  let cgstAmt = parseAmount(getFirst(f, ["CGST_AMOUNT","CGST AMOUNT","CGST"]));
  let sgstAmt = parseAmount(getFirst(f, ["SGST_AMOUNT","SGST AMOUNT","SGST"]));

  if (!igstAmt && igstPct) igstAmt = +(taxable * igstPct / 100).toFixed(2);
  if (!cgstAmt && cgstPct) cgstAmt = +(taxable * cgstPct / 100).toFixed(2);
  if (!sgstAmt && sgstPct) sgstAmt = +(taxable * sgstPct / 100).toFixed(2);

  return {
    "SIZE":        getFirst(f, ["SIZE"]) || "",
    "TYPE":        getFirst(f, ["TYPE"]) || "",
    "CHARGES DESCRIPTION": getFirst(f, ["CHARGE_DESCRIPTION","CHARGES DESCRIPTION","DESCRIPTION"]) || "",
    "HSN/SAC":     getFirst(f, ["HSN/SAC","HSN_SAC_CODE"]) || "",
    "TAX":         getFirst(f, ["TAX","TAX CODE"]) || "",
    "BASED ON":    getFirst(f, ["BASED ON","BASED_ON"]) || "",
    "RATE":        getFirst(f, ["RATE"]) || "",
    "CURRENCY":    getFirst(f, ["CURRENCY"]) || "",
    "TAXABLE AMOUNT": taxable,
    "IGST %": igstPct, "IGST_AMOUNT": igstAmt,
    "SGST %": sgstPct, "SGST_AMOUNT": sgstAmt,
    "CGST %": cgstPct, "CGST_AMOUNT": cgstAmt,
  };
}

module.exports = { mapLineItem };
