// vendors/hapag.js
const { parseAmount, parsePercent, getFirst } = require("../helpers/common");

// Hapag-Lloyd me TAX code => C0/C2/G0/G2
function taxFromCode(code) {
 // switch ((code || "").trim().toUpperCase()) {
 switch ((code || "").toString().trim().toUpperCase()) {
    case "G0": return { igstPct: 5,  cgstPct: 0,  sgstPct: 0 };
    case "G2": return { igstPct: 18, cgstPct: 0,  sgstPct: 0 };
    case "C0": return { igstPct: 0,  cgstPct: 2.5, sgstPct: 2.5 };
    case "C2": return { igstPct: 0,  cgstPct: 9,   sgstPct: 9 };
    default:   return { igstPct: 0,  cgstPct: 0,   sgstPct: 0 };
  }
}

// Normalize one line to standard child schema + computed taxes
function mapLineItem(line) {
  const f = line.valueObject || {};

  // Hapag me taxable amount left of INR/USD hota hai. Try multiple keys, then fallback RATE
  let taxable = parseAmount(getFirst(f, [
    "TAXABLE_AMOUNT"
  ]));
  if (!taxable) taxable = parseAmount(getFirst(f, ["RATE"]));

  const taxCode = getFirst(f, ["TAX"]) || "";
  const { igstPct, cgstPct, sgstPct } = taxFromCode(taxCode);

  const igstAmt = +(taxable * igstPct / 100).toFixed(2);
  const cgstAmt = +(taxable * cgstPct / 100).toFixed(2);
  const sgstAmt = +(taxable * sgstPct / 100).toFixed(2);

  return {
    "SIZE":        getFirst(f, ["SIZE"]) || "",
    "TYPE":        getFirst(f, ["TYPE"]) || "",
    "CHARGE_DESCRIPTION": getFirst(f, ["CHARGE_DESCRIPTION"]) || "",
    "HSN_SAC_CODE":     getFirst(f, ["HSN_SAC_CODE","HSN/SAC"]) || "",
    "TAX":         taxCode,
    "BASED ON":    getFirst(f, ["BASED ON","BASED_ON"]) || "",
    "RATE":        getFirst(f, ["RATE"]) || "",
    "CURRENCY":    getFirst(f, ["CURRENCY"]) || "",
    "TAXABLE_AMOUNT": taxable,
    "IGST%": igstPct, "IGST_AMOUNT": igstAmt,
    "SGST%": sgstPct, "SGST_AMOUNT": sgstAmt,
    "CGST%": cgstPct, "CGST_AMOUNT": cgstAmt,
  };
}

module.exports = { mapLineItem };
