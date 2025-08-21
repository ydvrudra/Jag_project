// vendors/cma.js
const { parseAmount, parsePercent, getFirst } = require("../helpers/common");

function mapLineItem(line) {
  const f = line.valueObject || {};

  // Taxable value (CMA-CGM me "Taxable Amt." hai)
  const taxable = parseAmount(getFirst(f, [
    "Taxable Amt.", "TAXABLE AMOUNT", "ASSESSABLE VALUE"
  ]));

  // Percent fields
  const igstPct = parsePercent(getFirst(f, ["IGST %", "IGST@", "IGST_RATE"]));
  const cgstPct = parsePercent(getFirst(f, ["CGST %", "CGST@", "CGST_RATE"]));
  const sgstPct = parsePercent(getFirst(f, ["SGST %", "SGST@", "SGST_RATE"]));

  // Amount fields (direct if given)
  let igstAmt = parseAmount(getFirst(f, ["Tax Amount", "IGST_AMOUNT", "IGST AMOUNT"]));
  let cgstAmt = parseAmount(getFirst(f, ["CGST_AMOUNT","CGST AMOUNT"]));
  let sgstAmt = parseAmount(getFirst(f, ["SGST_AMOUNT","SGST AMOUNT"]));

  // Fallback calculation if missing
  if (!igstAmt && igstPct) igstAmt = +(taxable * igstPct / 100).toFixed(2);
  if (!cgstAmt && cgstPct) cgstAmt = +(taxable * cgstPct / 100).toFixed(2);
  if (!sgstAmt && sgstPct) sgstAmt = +(taxable * sgstPct / 100).toFixed(2);

  return {
    "SIZE": getFirst(f, ["SIZE"]) || "",
    "TYPE": getFirst(f, ["TYPE"]) || "",
    "CHARGES DESCRIPTION": getFirst(f, [
      "CHARGE_DESCRIPTION","DESCRIPTION","Service Description"
    ]) || "",
    "HSN/SAC": getFirst(f, ["SAC","HSN/SAC"]) || "",
    "TAX": getFirst(f, ["TAX"]) || "",
    "BASED ON": getFirst(f, ["BASED ON"]) || "",
    "RATE": getFirst(f, ["RATE"]) || "",
    "CURRENCY": getFirst(f, ["CURRENCY"]) || "INR",
    "TAXABLE AMOUNT": taxable,
    "IGST %": igstPct, "IGST_AMOUNT": igstAmt,
    "SGST %": sgstPct, "SGST_AMOUNT": sgstAmt,
    "CGST %": cgstPct, "CGST_AMOUNT": cgstAmt,
  };
}

module.exports = { mapLineItem };
