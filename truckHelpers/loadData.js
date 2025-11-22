// truckHelpers/loadData.js
const { sql } = require('../config/sqlConfig');

// --- Auto CBM Calculator ---
function calculateCBM(lengthFt, widthFt, heightFt) {
  const l = Number(lengthFt) || 0;
  const w = Number(widthFt) || 0;
  const h = Number(heightFt) || 0;
  if (l === 0 || w === 0 || h === 0) return 0;

  // Convert cubic feet to CBM
  const cbm = (l * w * h) / 35.3147;
  return Number(cbm.toFixed(6));
}

// --- Unit Conversion ---
function unitToFeet(value, unitId) {
  if (value == null) return 0;
  switch (+unitId) {
    case 1: return value / 30.48;    // cm to feet
    case 2: return value / 12.0;     // inches to feet  
    case 3: return value;            // feet
    case 4: return value * 3.28084;  // meters to feet
    case 5: return value / 304.8;    // mm to feet
    default: return value;
  }
}

// --- 1) Load ONLY necessary header and packages ---
async function loadHeaderAndPackages(client, recordId, bodyPackages, calculationUnitId) {
  let hdr = { CalculationUnitId: calculationUnitId }; // ✅ Form se aayega
  let pkgRows = [];

  if (recordId) {
    // ✅ ONLY get CalculationUnitId from header
    const hdrRs = await client.request()
      .input('RecordId', sql.Int, recordId)
      .query(`
        SELECT TOP 1 CalculationUnitId
        FROM EnquiryGenerationNew
        WHERE EnquiryGenerationNewId = @RecordId
      `);
    
    if (!hdrRs.recordset.length) throw new Error('Enquiry not found');
    hdr.CalculationUnitId = hdrRs.recordset[0].CalculationUnitId;

    // ✅ Load packages
    const cargoRs = await client.request()
      .input('RecordId', sql.Int, recordId)
      .query(`
        SELECT 
          EnquiryDimensionsDetailsId,
          cNoofPackages, 
          cLength, 
          cWidth, 
          cHeight,
          cTotalPackageWeight,
          ChildstackableId
        FROM EnquiryDimensionsDetails
        WHERE EnquiryGenerationNewId = @RecordId
      `);

    pkgRows = cargoRs.recordset || [];
    if (!pkgRows.length) return { hdr, pkgs: [] };

  } else {
    // ✅ Direct from body packages
    if (!Array.isArray(bodyPackages) || bodyPackages.length === 0)
      throw new Error('Either recordId or packages array required');

    pkgRows = bodyPackages.map((p, idx) => ({
      EnquiryDimensionsDetailsId: p.pkgId || idx + 1,
      cNoofPackages: p.qty || 1,
      cLength: p.length || 0,
      cWidth: p.width || 0,
      cHeight: p.height || 0,
      cTotalPackageWeight: p.weightKg || 0,
      ChildstackableId: (p.stackable === false) ? 0 : 1
    }));

    hdr.CalculationUnitId = calculationUnitId; // ✅ Form se aaya hua
  }

  // ✅ Clean package mapping
  const pkgs = pkgRows.map(r => {
    const qty = Number(r.cNoofPackages || 1);
    
    // Convert to feet based on unit from form
    const Lft = unitToFeet(Number(r.cLength || 0), hdr.CalculationUnitId);
    const Wft = unitToFeet(Number(r.cWidth || 0), hdr.CalculationUnitId);
    const Hft = unitToFeet(Number(r.cHeight || 0), hdr.CalculationUnitId);

    const cbmPerPkg = calculateCBM(Lft, Wft, Hft);
    const weightKg = Number(r.cTotalPackageWeight || 0);
    const stackable = (r.ChildstackableId === 0) ? false : true;

    return {
      pkgId: r.EnquiryDimensionsDetailsId,
      qty,
      lengthFt: Lft,
      widthFt: Wft, 
      heightFt: Hft,
      cbm: cbmPerPkg,
      weightKg: weightKg,
      stackable
    };
  });

  return { hdr, pkgs };
}


// --- 2) Load ONLY necessary vehicle data ---
async function loadVehiclesAndCapacities(client) {
  const vehRs = await client.request().query(`
    SELECT 
      VehicleTypeMasterId AS truckId, 
      VehicleName AS truckName,
      Length AS lengthFt, 
      Width AS widthFt, 
      Height AS heightFt,
      ISNULL(CBMCapacity, 0) AS cbmCapacity,
      VehicleCapacityId
    FROM VehicleTypeMaster
    -- WHERE IsActive = 1  ✅ REMOVE THIS LINE
    ORDER BY CBMCapacity ASC
  `);

  const vehiclesRaw = vehRs.recordset || [];

  // ✅ Load capacities
  const capRs = await client.request().query(`
    SELECT CapcityMasterId, CapacityInKg 
    FROM CapcityMaster
  `);
  
  const caps = {};
  for (const c of capRs.recordset || []) {
    caps[c.CapcityMasterId] = Number(c.CapacityInKg || 0);
  }

  // ✅ Usable dimensions (with clearance)
  const CLEAR_L = 0.25, CLEAR_W = 0.25, CLEAR_H = 0.25;

  return vehiclesRaw.map(v => ({
    truckId: v.truckId,
    truckName: v.truckName,
    lengthFt: Number(v.lengthFt || 0),
    widthFt: Number(v.widthFt || 0), 
    heightFt: Number(v.heightFt || 0),
    cbmCapacity: Number(v.cbmCapacity || 0),
    maxWeightKg: caps[v.VehicleCapacityId] || 0,
    usableLengthFt: Math.max(0, Number(v.lengthFt) - CLEAR_L),
    usableWidthFt: Math.max(0, Number(v.widthFt) - CLEAR_W),
    usableHeightFt: Math.max(0, Number(v.heightFt) - CLEAR_H)
  }));
}

module.exports = { loadHeaderAndPackages, loadVehiclesAndCapacities };