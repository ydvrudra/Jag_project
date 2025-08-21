// vendors/detect.js
function detectVendor(fields) {
  const supplier = (fields["SUPPLIER NAME"]?.content || "").toLowerCase();

  if (supplier.includes("hapag") || supplier.includes("lloyd")) return "hapag";
  if (supplier.includes("cma") || supplier.includes("cma-cgm") || supplier.includes("cma cgm")) return "cma";
  if (supplier.includes("maersk")) return "maersk";
  if (supplier.includes("msc")) return "msc";
  return "generic";
}

module.exports = { detectVendor };
