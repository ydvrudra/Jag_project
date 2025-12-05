// truckHelpers/truckAllocationHelpers.js
const { sql } = require('../config/sqlConfig');

// Helper function to get default currency
async function getDefaultCurrency(client) {
  try {
    const query = `
      SELECT TOP 1 CurrencyCode 
      FROM CurrencyMaster 
      WHERE IsDefault = 1
    `;
    const result = await client.request().query(query);
    return result.recordset[0]?.CurrencyCode || 'INR';
  } catch (error) {
    return 'INR';
  }
}

async function processFinalAllocations({ 
  allocationsInstances = [], 
  remainingPkgs = [], 
  client, 
  vehicles = [] ,
  truckRatesMap = {} 
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
        usedCBM: Number(inst.usedCBM || 0),  
        usedWeightKg: Number(inst.usedWeight || 0) 
      })),
      remainingCount: finalRemaining
    };
    return { totalTruckingChargesInUSD: 0, allocationsStatus };
  }

  // ✅ Aggregate instances per truckId
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
    grouped[inst.truckId].usedCBM += Number(inst.usedCBM || 0);  
    grouped[inst.truckId].usedWeightKg += inst.usedWeight;
  }

  const finalAllocations = Object.values(grouped);

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

  // ✅ DYNAMIC DEFAULT CURRENCY
  const defaultCurrency = await getDefaultCurrency(client);
  const firstTruckCurrency = finalAllocations.length > 0 
    ? (truckRatesMap[finalAllocations[0].truckId]?.currency || defaultCurrency)
    : defaultCurrency;

  const allocationsStatus = {
    status: 'success',
    message: 'All packages allocated',
    allocations: finalAllocations.map(alloc => ({
      truckId: alloc.truckId,
      truckName: alloc.truckName,
      truckCount: alloc.truckCount,
      qtyItems: alloc.qtyItems,
      usedCBM: alloc.usedCBM,
      usedWeightKg: alloc.usedWeightKg,
      ratePerTruck: truckRatesMap[alloc.truckId]?.rate || 0,
      currency: truckRatesMap[alloc.truckId]?.currency || firstTruckCurrency,
      totalForThisTruck: (truckRatesMap[alloc.truckId]?.rate || 0) * alloc.truckCount
    })),
    totalCost: finalAllocations.reduce((sum, alloc) => 
      sum + ((truckRatesMap[alloc.truckId]?.rate || 0) * alloc.truckCount), 0),
    currency: firstTruckCurrency 
  };

  return { allocationsStatus };
}

module.exports = { processFinalAllocations };