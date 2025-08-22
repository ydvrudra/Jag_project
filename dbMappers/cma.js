// dbMappers/cma.js
function mapDbLineItem(line) {
  return {
    SIZE: line["SIZE"]?.valueString || "",
    TYPE: line["TYPE"]?.valueString || "",
    CHARGES_DESCRIPTION: line["CHARGE_DESCRIPTION"]?.valueString || "",
    HSN_SAC: line["HSN_SAC_CODE"]?.valueString || "",
    TAX: line["TAX"]?.valueString || "",
    BASED_ON: line["BASED ON"]?.valueString || "",
    RATE: parseFloat(line["RATE"]?.valueString || 0),
    CURRENCY: line["CURRENCY"]?.valueString || "",
    TAXABLE_AMOUNT: parseFloat(line["TAXABLE_AMOUNT"]?.valueString || 0),
    IGST_PERCENT: parseFloat(line["IGST%"]?.valueString || 0),
    IGST_AMOUNT: parseFloat(line["IGST_AMOUNT"]?.valueString || 0),
    SGST_PERCENT: parseFloat(line["SGST%"]?.valueString || 0),
    SGST_AMOUNT: parseFloat(line["SGST_AMOUNT"]?.valueString || 0),
    CGST_PERCENT: parseFloat(line["CGST%"]?.valueString || 0),
    CGST_AMOUNT: parseFloat(line["CGST_AMOUNT"]?.valueString || 0),
  };
}

module.exports = { mapDbLineItem };
