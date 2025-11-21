// truckHelpers/truckAllocationHelpers.js
const { sql } = require('../config/sqlConfig');

async function processFinalAllocations({ allocationsInstances, remainingPkgs, client, hdr, vehicles, persist, recordId, userId }) {
  // --- 1) Check remaining packages ---
  const finalRemaining = remainingPkgs.reduce((s, x) => s + x.qty, 0);
  let allocationsStatus = null;

  if (finalRemaining > 0) {
    allocationsStatus = {
      status: 'partial_allocated',
      message: `Allocated ${allocationsInstances.reduce((s, i) => s + i.items.reduce((ss, it) => ss + it.qty, 0), 0)}/${allocationsInstances.reduce((s, i) => s + i.items.reduce((ss, it) => ss + it.qty, 0), 0) + finalRemaining}. ${finalRemaining} remain`,
      allocations: allocationsInstances.map(inst => ({
        truckId: inst.truckId,
        truckName: inst.truckName,
        qty: inst.items.reduce((s, it) => s + it.qty, 0),
        usedCBM: inst.usedCBM,
        usedWeightKg: inst.usedWeight
      })),
      remainingCount: finalRemaining,
      remainingSample: remainingPkgs.filter(p => p.qty > 0).slice(0, 5)
    };
    return { finalAllocations: [], suggestions: [], totalTruckingChargesInUSD: 0, allocationsStatus };
  }

  // --- 2) Aggregate instances per truckId with correct package qty ---
  const grouped = {};
  for (const inst of allocationsInstances) {
    if (!grouped[inst.truckId]) grouped[inst.truckId] = { truckId: inst.truckId, truckName: inst.truckName, qty: 0, usedCBM: 0, usedWeightKg: 0 };
    grouped[inst.truckId].qty += inst.items.reduce((s, it) => s + it.qty, 0);  // <-- fixed
    grouped[inst.truckId].usedCBM += inst.usedCBM;
    grouped[inst.truckId].usedWeightKg += inst.usedWeight;
  }
  const finalAllocations = Object.values(grouped);

  // --- 3) Pricing & suggestion calculation ---
  const suggestions = [];
  let totalTruckingChargesInUSD = 0;
  for (const alloc of finalAllocations) {
    const mvRs = await client.request().input('VehicleId', sql.Int, alloc.truckId)
      .query(`SELECT TOP 1 ColumnName FROM MapVehicle WHERE VehicleId = @VehicleId`);
    const mapCol = mvRs.recordset[0] ? mvRs.recordset[0].ColumnName : null;
    let rateVal = 0, currencyId = null;

    if (mapCol) {
      const qcol = '[' + mapCol.replace(']', '') + ']';
      const dyn = `SELECT TOP 1 ${qcol} AS RateVal, tcr.CurrencyId 
                   FROM TruckingContractsRate tcr 
                   WHERE tcr.PickupLocationId = @FromPinCodeId 
                     AND tcr.FinalLocationId = ISNULL(@ToLocationId, @ToLocationRouteId)`;
      const rateRs = await client.request()
        .input('FromPinCodeId', sql.Int, hdr.FromPinCodeId || 0)
        .input('ToLocationId', sql.Int, hdr.LocationId || 0)
        .input('ToLocationRouteId', sql.Numeric(18, 3), hdr.ToLocationRouteId || 0)
        .query(dyn);
      if (rateRs.recordset[0]) { rateVal = Number(rateRs.recordset[0].RateVal || 0); currencyId = rateRs.recordset[0].CurrencyId; }
    }

    const appRs = await client.request()
      .input('CompanyId', sql.Int, hdr.CompanyId || 0)
      .input('SegmentId', sql.Int, hdr.SegmentId || 0)
      .query(`SELECT TOP 1 AppreciationPer FROM AppreciationConfiguration 
              WHERE CompanyId=@CompanyId AND SegmentId=@SegmentId 
              ORDER BY AppreciationConfigurationId DESC`);
    const appreciation = (appRs.recordset[0] && appRs.recordset[0].AppreciationPer) ? Number(appRs.recordset[0].AppreciationPer) : 0;

    const rateAfterApp = rateVal + (rateVal * appreciation / 100.0);

    let exch = 1;
    if (currencyId) {
      const exRs = await client.request()
        .query(`SELECT TOP 1 ExchageRateCurrencyToUsd FROM ExchangeRatesDetails 
                WHERE ExchangeRatesHdrId = (SELECT MAX(ExchangeRatesHdrId) FROM ExchangeRatesHdr) 
                  AND CurrencyId = ${Number(currencyId)}`);
      if (exRs.recordset[0]) exch = Number(exRs.recordset[0].ExchageRateCurrencyToUsd || 1);
    }

    suggestions.push({
      truckId: alloc.truckId,
      truckName: alloc.truckName,
      usedCBM: alloc.usedCBM,
      usedWeightKg: alloc.usedWeightKg,
      chargePerTruck: rateAfterApp,
      chargePerTruckUSD: rateAfterApp * exch
    });
    totalTruckingChargesInUSD += (rateAfterApp * exch) * alloc.qty;
  }

  // --- 4) Persist if required ---
  if (persist && recordId) {
    // ... keep existing persist logic ...
  }

  // --- 5) Final validation for overloading ---
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
    totalTruckingChargesInUSD
  };

  return { finalAllocations, suggestions, totalTruckingChargesInUSD, allocationsStatus };
}

module.exports = { processFinalAllocations };