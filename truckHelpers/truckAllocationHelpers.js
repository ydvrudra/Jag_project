// truckHelpers/truckAllocationHelpers.js
const { sql } = require('../config/sqlConfig');

async function processFinalAllocations({ 
  allocationsInstances = [], 
  remainingPkgs = [], 
  client, 
  vehicles = [] 
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
    grouped[inst.truckId].usedWeightKg = Math.max(grouped[inst.truckId].usedWeightKg, inst.usedWeight);
  }

  const finalAllocations = Object.values(grouped);

  // ✅ Simple pricing calculation
  const suggestions = [];
  let totalTruckingChargesInUSD = 0;

  for (const alloc of finalAllocations) {
    const baseCharge = 100;
    const totalForThisTypeUSD = baseCharge * (alloc.truckCount || 1);

    suggestions.push({
      truckId: alloc.truckId,
      truckName: alloc.truckName,
      truckCount: alloc.truckCount,
      qtyItems: alloc.qtyItems,
      usedCBM: Number(alloc.usedCBM || 0),  // ✅ FIX: Ensure number
      usedWeightKg: Number(alloc.usedWeightKg || 0),  // ✅ FIX: Ensure number
      chargePerTruck: baseCharge,
      chargePerTruckUSD: baseCharge,
      totalChargeUSD: totalForThisTypeUSD
    });

    totalTruckingChargesInUSD += totalForThisTypeUSD;
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