// truckHelpers/truckAllocationHelpers.js
const { sql } = require('../config/sqlConfig');

async function processFinalAllocations({ allocationsInstances = [], remainingPkgs = [], client, hdr = {}, vehicles = [], persist, recordId, userId }) {
  // --- 0) Safety defaults ---
  remainingPkgs = Array.isArray(remainingPkgs) ? remainingPkgs : [];

  // --- 1) Check remaining packages ---
  const finalRemaining = remainingPkgs.reduce((s, x) => s + (Number(x.qty || 0)), 0);
  let allocationsStatus = null;

  if (finalRemaining > 0) {
    const allocatedCount = allocationsInstances.reduce((s, i) => s + i.items.reduce((ss, it) => ss + (it.qty || 0), 0), 0);
    allocationsStatus = {
      status: 'partial_allocated',
      message: `Allocated ${allocatedCount}/${allocatedCount + finalRemaining}. ${finalRemaining} remain`,
      allocations: allocationsInstances.map(inst => ({
        truckId: inst.truckId,
        truckName: inst.truckName,
        qtyItems: inst.items.reduce((s, it) => s + (it.qty || 0), 0),
        usedCBM: inst.usedCBM,
        usedWeightKg: inst.usedWeight
      })),
      remainingCount: finalRemaining,
      remainingSample: remainingPkgs.filter(p => (p.qty || 0) > 0).slice(0, 5)
    };
    return { finalAllocations: [], suggestions: [], totalTruckingChargesInUSD: 0, allocationsStatus };
  }

  // --- 2) Aggregate instances per truckId with correct package qty AND truck count ---
  const grouped = {};
  for (const inst of allocationsInstances) {
    if (!grouped[inst.truckId]) grouped[inst.truckId] = {
      truckId: inst.truckId,
      truckName: inst.truckName,
      truckCount: 0,        // number of truck instances used
      qtyItems: 0,          // total package qty carried across those trucks
      usedCBM: 0,
      usedWeightKg: 0
    };
    grouped[inst.truckId].truckCount += 1;
    grouped[inst.truckId].qtyItems += inst.items.reduce((s, it) => s + (it.qty || 0), 0);
    grouped[inst.truckId].usedCBM += Number(inst.usedCBM || 0);
    grouped[inst.truckId].usedWeightKg += Number(inst.usedWeight || 0);
  }
  const finalAllocations = Object.values(grouped);

  // --- 3) Pricing & suggestion calculation ---
  const suggestions = [];
  let totalTruckingChargesInUSD = 0;
  for (const alloc of finalAllocations) {
    // Map vehicle column
    const mvRs = await client.request()
      .input('VehicleId', sql.Int, alloc.truckId)
      .query(`SELECT TOP 1 ColumnName FROM MapVehicle WHERE VehicleId = @VehicleId`);
    const mapCol = mvRs.recordset[0] ? mvRs.recordset[0].ColumnName : null;
    let rateVal = 0, currencyId = null;

    if (mapCol) {
      // sanitize column name: remove any surrounding brackets then re-wrap
      const safeCol = '[' + String(mapCol).replace(/[\[\]]+/g, '') + ']';
      const dyn = `
        SELECT TOP 1 ${safeCol} AS RateVal, tcr.CurrencyId
        FROM TruckingContractsRate tcr
        WHERE tcr.PickupLocationId = @FromPinCodeId
          AND tcr.FinalLocationId = ISNULL(@ToLocationId, @ToLocationRouteId)
      `;
      const rateRs = await client.request()
        .input('FromPinCodeId', sql.Int, hdr.FromPinCodeId || 0)
        .input('ToLocationId', sql.Int, hdr.LocationId || 0)
        .input('ToLocationRouteId', sql.Numeric(18, 3), hdr.ToLocationRouteId || 0)
        .query(dyn);
      if (rateRs.recordset[0]) {
        rateVal = Number(rateRs.recordset[0].RateVal || 0);
        currencyId = rateRs.recordset[0].CurrencyId;
      }
    }

    // Appreciation
    const appRs = await client.request()
      .input('CompanyId', sql.Int, hdr.CompanyId || 0)
      .input('SegmentId', sql.Int, hdr.SegmentId || 0)
      .query(`SELECT TOP 1 AppreciationPer FROM AppreciationConfiguration 
              WHERE CompanyId=@CompanyId AND SegmentId=@SegmentId 
              ORDER BY AppreciationConfigurationId DESC`);
    const appreciation = (appRs.recordset[0] && appRs.recordset[0].AppreciationPer) ? Number(appRs.recordset[0].AppreciationPer) : 0;
    const rateAfterApp = rateVal + (rateVal * appreciation / 100.0);

    // Exchange rate (parameterized)
    let exch = 1;
    if (currencyId) {
      const exRs = await client.request()
        .input('CurrencyId', sql.Int, Number(currencyId))
        .query(`SELECT TOP 1 ExchageRateCurrencyToUsd FROM ExchangeRatesDetails 
                WHERE ExchangeRatesHdrId = (SELECT MAX(ExchangeRatesHdrId) FROM ExchangeRatesHdr) 
                  AND CurrencyId = @CurrencyId`);
      if (exRs.recordset[0]) exch = Number(exRs.recordset[0].ExchageRateCurrencyToUsd || 1);
    }

    // chargePerTruck USD and total by number of truck instances (truckCount)
    const chargePerTruck = rateAfterApp;
    const chargePerTruckUSD = rateAfterApp * exch;
    const totalForThisTypeUSD = (chargePerTruckUSD * (alloc.truckCount || 1));

    suggestions.push({
      truckId: alloc.truckId,
      truckName: alloc.truckName,
      truckCount: alloc.truckCount,
      qtyItems: alloc.qtyItems,
      usedCBM: alloc.usedCBM,
      usedWeightKg: alloc.usedWeightKg,
      chargePerTruck,
      chargePerTruckUSD,
      totalChargeUSD: totalForThisTypeUSD
    });

    totalTruckingChargesInUSD += totalForThisTypeUSD;
  }

  // --- 4) Persist if required ---
  if (persist && recordId) {
    // ... keep existing persist logic (unchanged) ...
  }

  // --- 5) Final validation for overloading (validate per-instance) ---
  for (const inst of allocationsInstances) {
    const truckInfo = vehicles.find(v => v.truckId === inst.truckId);
    if (truckInfo && (inst.usedWeight > truckInfo.maxWeightKg || inst.usedCBM > truckInfo.cbmCapacity)) {
      allocationsStatus = {
        status: 'invalid-allocation',
        message: `Truck ${truckInfo.truckName} overloaded — please select a bigger truck`,
        truck: truckInfo,
        usedWeight: inst.usedWeight,
        usedCBM: inst.usedCBM
      };
      return { finalAllocations: [], suggestions: [], totalTruckingChargesInUSD: 0, allocationsStatus };
    }
  }

  allocationsStatus = {
    status: 'success',
    message: 'All packages allocated',
    allocations: finalAllocations,
    suggestions,
    totalTruckingChargesInUSD
  };

  return { finalAllocations, suggestions, totalTruckingChargesInUSD, allocationsStatus };
}

module.exports = { processFinalAllocations };
