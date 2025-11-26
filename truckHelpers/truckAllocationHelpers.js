// truckHelpers/truckAllocationHelpers.js
const { sql } = require('../config/sqlConfig');

async function processFinalAllocations({ 
  allocationsInstances = [], 
  remainingPkgs = [], 
  client, 
  vehicles = [] ,
  fromLocationId,     
  toLocationId   
}) {
  // ✅ Safety defaults
  remainingPkgs = Array.isArray(remainingPkgs) ? remainingPkgs : [];

  // ✅ Check remaining packages
  const finalRemaining = remainingPkgs.reduce((s, x) => s + (Number(x.qty || 0)), 0);
  
  if (finalRemaining > 0) {
    const allocatedCount = allocationsInstances.reduce((s, i) => 
      s + i.items.reduce((ss, it) => ss + (it.qty || 0), 0), 0);
    
    const allocationsStatus = {
      status: 'partial_allocated',
      message: `Allocated ${allocatedCount}/${allocatedCount + finalRemaining}. ${finalRemaining} remain`,
      allocations: allocationsInstances.map(inst => ({
        truckId: inst.truckId,
        truckName: inst.truckName,
        qtyItems: inst.items.reduce((s, it) => s + (it.qty || 0), 0),
        usedCBM: Number(inst.usedCBM || 0),  // ✅ FIX: Ensure number
        usedWeightKg: Number(inst.usedWeight || 0)  // ✅ FIX: Ensure number
      })),
      remainingCount: finalRemaining
    };
    return { totalTruckingChargesInUSD: 0, allocationsStatus };
  }

  // ✅ Aggregate instances per truckId - FIX USEDCBM
  const grouped = {};
  for (const inst of allocationsInstances) {
    if (!grouped[inst.truckId]) {
      grouped[inst.truckId] = {
        truckId: inst.truckId,
        truckName: inst.truckName,
        truckCount: 0,
        qtyItems: 0,
        usedCBM: 0,
        usedWeightKg: 0
      };
    }
    grouped[inst.truckId].truckCount += 1;
    grouped[inst.truckId].qtyItems += inst.items.reduce((s, it) => s + (it.qty || 0), 0);
    grouped[inst.truckId].usedCBM += Number(inst.usedCBM || 0);  // ✅ FIX: Add usedCBM
    grouped[inst.truckId].usedWeightKg += inst.usedWeight;
  }

  const finalAllocations = Object.values(grouped);


 async function getRealTruckPricing(client, truckId, truckCount, fromLocationId, toLocationId, companyId = 0, segmentId = 0) {
  try {
    // 1. GET APPRECIATION RATE
    let appreciationRate = 0;
    if (companyId && segmentId) {
      const appreciationQuery = `
        SELECT TOP 1 ISNULL(AppreciationPer, 0) AS AppreciationPer
        FROM AppreciationConfiguration
        WHERE CompanyId = @companyId AND SegmentId = @segmentId
        ORDER BY AppreciationConfigurationId DESC
      `;
      const appreciationResult = await client.request()
        .input('companyId', sql.Int, companyId)
        .input('segmentId', sql.Int, segmentId)
        .query(appreciationQuery);
      
      appreciationRate = appreciationResult.recordset[0]?.AppreciationPer || 0;
    }

    // 2. Get rate column name from MapVehicle
    const mapQuery = `SELECT ColumnName FROM MapVehicle WHERE VehicleId = @truckId`;
    const mapResult = await client.request().input('truckId', sql.Int, truckId).query(mapQuery);
    
    if (!mapResult.recordset.length) return { rate: 0, totalForThisTypeUSD: 0 };
    
    const rateColumn = mapResult.recordset[0].ColumnName;
    
    // 3. Get rate from TruckingContractsRate WITH COMPANY/SEGMENT FILTER IF AVAILABLE
    let rateQuery = `
      SELECT ${rateColumn} AS Rate, CurrencyId
      FROM TruckingContractsRate 
      WHERE PickupLocationId = @fromLocationId AND FinalLocationId = @toLocationId
    `;
    
    if (companyId) {
      rateQuery += ` AND CompanyId = @companyId`;
    }
    if (segmentId) {
      rateQuery += ` AND SegmentId = @segmentId`;
    }

    const request = client.request()
      .input('fromLocationId', sql.Int, fromLocationId)
      .input('toLocationId', sql.Int, toLocationId);
    
    if (companyId) request.input('companyId', sql.Int, companyId);
    if (segmentId) request.input('segmentId', sql.Int, segmentId);
    
    const rateResult = await request.query(rateQuery);
    
    const rate = rateResult.recordset[0]?.Rate || 0;
    const currencyId = rateResult.recordset[0]?.CurrencyId || 1;
    
    // 4. APPLY APPRECIATION RATE
    const rateWithAppreciation = rate + (rate * appreciationRate / 100);
    
    // 5. Convert to USD with LATEST exchange rates
    let rateUSD = rateWithAppreciation;
    if (currencyId !== 1) {
      const exchangeQuery = `
        SELECT TOP 1 ISNULL(ExchageRateCurrencyToUsd, 1) AS ExchangeRate
        FROM ExchangeRatesDetails 
        WHERE CurrencyId = @currencyId 
          AND ExchangeRatesHdrId = (SELECT MAX(ExchangeRatesHdrId) FROM ExchangeRatesHdr)
      `;
      const exchangeResult = await client.request()
        .input('currencyId', sql.Int, currencyId)
        .query(exchangeQuery);
      
      const exchangeRate = exchangeResult.recordset[0]?.ExchangeRate || 1;
      rateUSD = rateWithAppreciation * exchangeRate;
    }
    
    return {
      rate: rateUSD,
      ratePerTruck: rateUSD,
      totalForThisTypeUSD: rateUSD * truckCount,
      currency: 'USD'
    };
    
  } catch (error) {
    console.error('Pricing error:', error);
    return { rate: 100, ratePerTruck: 100, totalForThisTypeUSD: 100 * truckCount, currency: 'USD' };
  }
}

  // ✅ REAL PRICING calculation
const suggestions = [];
let totalTruckingChargesInUSD = 0;

for (const alloc of finalAllocations) {
  const pricing = await getRealTruckPricing(
    client, 
    alloc.truckId, 
    alloc.truckCount,
    fromLocationId,  // ✅ USE PASSED PARAMETER
    toLocationId     // ✅ USE PASSED PARAMETER
  );

  suggestions.push({
    truckId: alloc.truckId,
    truckName: alloc.truckName,
    truckCount: alloc.truckCount,
    qtyItems: alloc.qtyItems,
    usedCBM: Number(alloc.usedCBM || 0),
    usedWeightKg: Number(alloc.usedWeightKg || 0),
    chargePerTruck: pricing.ratePerTruck,      // ✅ REAL RATE
    chargePerTruckUSD: pricing.ratePerTruck,   // ✅ REAL RATE
    totalChargeUSD: pricing.totalForThisTypeUSD // ✅ REAL RATE
  });

  totalTruckingChargesInUSD += pricing.totalForThisTypeUSD;
}

  // ✅ Final validation
  for (const inst of allocationsInstances) {
    const truckInfo = vehicles.find(v => v.truckId === inst.truckId);
    if (truckInfo && (inst.usedWeight > truckInfo.maxWeightKg || inst.usedCBM > truckInfo.cbmCapacity)) {
      const allocationsStatus = {
        status: 'invalid-allocation',
        message: `Truck ${truckInfo.truckName} overloaded`,
        truck: truckInfo.truckName,
        usedWeight: inst.usedWeight,
        usedCBM: inst.usedCBM
      };
      return { totalTruckingChargesInUSD: 0, allocationsStatus };
    }
  }

  const allocationsStatus = {
    status: 'success',
    message: 'All packages allocated',
    allocations: finalAllocations,
    suggestions,
    totalTruckingChargesInUSD
  };

  return { totalTruckingChargesInUSD, allocationsStatus };
}

module.exports = { processFinalAllocations };