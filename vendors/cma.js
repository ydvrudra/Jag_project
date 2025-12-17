// vendors/cma.js
const { parseAmount, parsePercent, getFirst } = require("../helpers/common");

function mapLineItem(line) {
  const f = line.valueObject || {};
  //console.log("Raw fields:", f);


  // Taxable value (CMA-CGM me "Taxable Amt." hai)
  const taxable = parseAmount(getFirst(f, [
     "TAXABLE_AMOUNT", "ASSESSABLE VALUE"
  ]));

  // Percent fields
  const igstPct = parsePercent(getFirst(f, ["IGST%"]));
  const cgstPct = parsePercent(getFirst(f, ["CGST%"]));
  const sgstPct = parsePercent(getFirst(f, ["SGST%"]));

  // Amount fields (direct if given)
  let igstAmt = parseAmount(getFirst(f, ["IGST_AMOUNT"]));
  let cgstAmt = parseAmount(getFirst(f, ["CGST_AMOUNT","CGST AMOUNT"]));
  let sgstAmt = parseAmount(getFirst(f, ["SGST_AMOUNT","SGST AMOUNT"]));

  // Fallback calculation if missing
  if (!igstAmt && igstPct) igstAmt = +(taxable * igstPct / 100).toFixed(2);
  if (!cgstAmt && cgstPct) cgstAmt = +(taxable * cgstPct / 100).toFixed(2);
  if (!sgstAmt && sgstPct) sgstAmt = +(taxable * sgstPct / 100).toFixed(2);

  const mapped = {
    "SIZE": getFirst(f, ["SIZE"]) || "",
    "TYPE": getFirst(f, ["TYPE"]) || "",
    "CHARGE_DESCRIPTION": getFirst(f, [
      "CHARGE_DESCRIPTION",
    ]) || "",
    "HSN_SAC_CODE": getFirst(f, ["HSN_SAC_CODE"]) || "",
    "TAX": getFirst(f, ["TAX"]) || "",
    "BASED ON": getFirst(f, ["BASED ON"]) || "",
    "RATE": getFirst(f, ["RATE"]) || "",
    "CURRENCY": getFirst(f, ["CURRENCY"]) || "INR",
    "TAXABLE_AMOUNT": taxable,
    "IGST%": igstPct, "IGST_AMOUNT": igstAmt,
    "SGST%": sgstPct, "SGST_AMOUNT": sgstAmt,
    "CGST%": cgstPct, "CGST_AMOUNT": cgstAmt,
  };
  //console.log("Mapped CMA line item:", mapped);  

  return mapped;
}



module.exports = { mapLineItem };
