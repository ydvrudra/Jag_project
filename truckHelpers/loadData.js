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

// --- 1) Load header and packages ---
async function loadHeaderAndPackages(client, recordId, bodyPackages, calculationUnitId = 3) {
  let hdr = { CalculationUnitId: 3, FromPinCodeId: 0, ToLocationRouteId: 0, CompanyId: 0, SegmentId: 0, LocationId: 0 };
  let pkgRows = [];

  if (recordId) {
    const hdrRs = await client.request()
      .input('RecordId', sql.Int, recordId)
      .query(`
        SELECT TOP 1 EnquiryGenerationNewId, CalculationUnitId, CheckCBMWeightId,
                       SegmentId, FromPinCodeId, ToLocationRouteId, CompanyId, LocationId
        FROM EnquiryGenerationNew
        WHERE EnquiryGenerationNewId = @RecordId
      `);
    if (!hdrRs.recordset.length) throw new Error('Enquiry not found');
    hdr = hdrRs.recordset[0];

    const cargoRs = await client.request()
      .input('RecordId', sql.Int, recordId)
      .query(`
        SELECT EnquiryDimensionsDetailsId, cNoofPackages, cLength, cWidth, cHeight,
               cCBM, cTotalPackageWeight, ChildstackableId
        FROM EnquiryDimensionsDetails
        WHERE EnquiryGenerationNewId = @RecordId
      `);

    pkgRows = cargoRs.recordset || [];
    if (!pkgRows.length) return { hdr, pkgs: [] };

  } else {
    if (!Array.isArray(bodyPackages) || bodyPackages.length === 0)
      throw new Error('Either recordId or packages array required');

    

    pkgRows = bodyPackages.map((p, idx) => ({
      EnquiryDimensionsDetailsId: p.pkgId || idx + 1,
      cNoofPackages: p.qty || p.count || 1,
      cLength: p.length,
      cWidth: p.width,
      cHeight: p.height,
      cCBM: p.cbm || null,
      cTotalPackageWeight: p.weight || p.weightKg || 0,
      ChildstackableId: (typeof p.stackable === 'boolean') ? (p.stackable ? 1 : 0) : 1
    }));

    hdr.CalculationUnitId = calculationUnitId || 3;
  }

  const unitToFeet = (value, unitId) => {
    if (value == null) return 0;
    switch (+unitId) {
      case 1: return value / 30.48;
      case 2: return value / 12.0;
      case 3: return value;
      case 4: return value * 3.28084;
      case 5: return value / 304.8;
      default: return value;
    }
  };

  // --- Package mapping ---
  const pkgs = pkgRows.map(r => {
    const qty = Number(r.cNoofPackages || 1);

const Lft = Number(r.cLength || r.length || bodyPackages?.find(p => p.pkgId === r.EnquiryDimensionsDetailsId)?.lengthFt || 0);
const Wft = Number(r.cWidth || r.width || bodyPackages?.find(p => p.pkgId === r.EnquiryDimensionsDetailsId)?.widthFt || 0);
const Hft = Number(r.cHeight || r.height || bodyPackages?.find(p => p.pkgId === r.EnquiryDimensionsDetailsId)?.heightFt || 0);



    //  Always auto-calc CBM
    const cbmPerPkg = calculateCBM(Lft, Wft, Hft);

    const perPkgWeight = Number(r.cTotalPackageWeight || 0);
    const stackable = (r.ChildstackableId == null) ? true : (r.ChildstackableId === 1);

    return {
      pkgId: r.EnquiryDimensionsDetailsId,
      qty,
      lengthFt: Number(Lft),
      widthFt: Number(Wft),
      heightFt: Number(Hft),
      cbm: Number(cbmPerPkg),
      weightKg: Number(perPkgWeight),
      stackable
    };
  });

  return { hdr, pkgs };
}

// --- 2) Load vehicles & capacities ---
async function loadVehiclesAndCapacities(client) {
  const vehRs = await client.request().query(`
    SELECT v.VehicleTypeMasterId AS truckId, v.VehicleName AS truckName,
           v.Length AS lengthFt, v.Width AS widthFt, v.Height AS heightFt,
           ISNULL(v.CBMCapacity, 0) AS cbmCapacity, v.VehicleCapacityId
    FROM VehicleTypeMaster v
    ORDER BY v.CBMCapacity ASC
  `);

  const vehiclesRaw = vehRs.recordset || [];

  const capRs = await client.request().query(`SELECT CapcityMasterId, CapacityInKg FROM CapcityMaster`);
  const caps = {};
  for (const c of capRs.recordset || []) caps[c.CapcityMasterId] = Number(c.CapacityInKg || 0);

  const CLEAR_L = 0.25, CLEAR_W = 0.25, CLEAR_H = 0.25;

  return vehiclesRaw.map(v => ({
    ...v,
    maxWeightKg: caps[v.VehicleCapacityId] || 0,
    usableLengthFt: Math.max(0, Number(v.lengthFt) - CLEAR_L),
    usableWidthFt: Math.max(0, Number(v.widthFt) - CLEAR_W),
    usableHeightFt: Math.max(0, Number(v.heightFt) - CLEAR_H),
    cbmCapacity: Number(v.cbmCapacity || 0)
  }));
}

// --- 3) Package orientation check ---
function packageFits3D(pkg, truck) {
  if (!pkg || !truck) return false;

  return (
    pkg.lengthFt <= truck.usableLengthFt &&
    pkg.widthFt <= truck.usableWidthFt &&
    pkg.heightFt <= truck.usableHeightFt
  );
}

module.exports = { loadHeaderAndPackages, loadVehiclesAndCapacities, packageFits3D };