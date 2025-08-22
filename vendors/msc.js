// vendors/msc.js
const { parseAmount, parsePercent, getFirst } = require("../helpers/common");

function mapLineItem(line) {
  const f = line.valueObject || {};

  // Extract values exactly as MSC JSON/labels show
  const taxable = parseAmount(getFirst(f, ["TAXABLE_AMOUNT", "TAXABLE AMOUNT", "TOTAL INR", "TOTAL_INR"]));
  
  const igstPct = parsePercent(getFirst(f, ["IGST%", "IGST %"]));
  const cgstPct = parsePercent(getFirst(f, ["CGST%", "CGST %"]));
  const sgstPct = parsePercent(getFirst(f, ["SGST%", "SGST %", "UGST%", "UGST %"]));

  let igstAmt = parseAmount(getFirst(f, ["IGST_AMOUNT", "IGST AMOUNT", "IGST"]));
  let cgstAmt = parseAmount(getFirst(f, ["CGST_AMOUNT", "CGST AMOUNT", "CGST"]));
  let sgstAmt = parseAmount(getFirst(f, ["SGST_AMOUNT", "SGST AMOUNT", "SGST", "UGST_AMOUNT"]));

  // Fallback calculation if only percentage exists
  if (!igstAmt && igstPct) igstAmt = +(taxable * igstPct / 100).toFixed(2);
  if (!cgstAmt && cgstPct) cgstAmt = +(taxable * cgstPct / 100).toFixed(2);
  if (!sgstAmt && sgstPct) sgstAmt = +(taxable * sgstPct / 100).toFixed(2);

  return {
    "SIZE":        getFirst(f, ["SIZE"]) || "",
    "TYPE":        getFirst(f, ["TYPE"]) || "",
    "CHARGES DESCRIPTION": getFirst(f, ["CHARGE DESCRIPTION", "CHARGES DESCRIPTION", "DESCRIPTION"]) || "",
    "HSN/SAC":     getFirst(f, ["HSN_SAC_CODE", "HSN/SAC", "HSN CODE"]) || "",
    "TAX":         getFirst(f, ["TAX", "TAX CODE"]) || "",
    "BASED ON":    getFirst(f, ["BASED ON", "BASED_ON"]) || "",
    "RATE":        getFirst(f, ["RATE"]) || "",
    "CURRENCY":    getFirst(f, ["CURRENCY", "CURR"]) || "",
    "TAXABLE AMOUNT": taxable,
    "IGST %": igstPct, "IGST_AMOUNT": igstAmt,
    "SGST %": sgstPct, "SGST_AMOUNT": sgstAmt,
    "CGST %": cgstPct, "CGST_AMOUNT": cgstAmt,
  };
}

module.exports = { mapLineItem };
