//truckHelpers/truckAllocation.js
const { sql } = require('../config/sqlConfig');
const { processFinalAllocations } = require('./truckAllocationHelpers');

function feet3ToCBM(lft, wft, hft) {
  return Number(((lft * wft * hft) * 0.028316846592).toFixed(6));
}

async function allocateTrucksAndPrice({
  client,
  pkgs,
  vehicles,
  persist,
  recordId,
  userId
}) {

  
  if (!pkgs || !pkgs.length) return { status: "no-packages", message: "No packages to allocate", allocations: [] };

  // ✅ Prepare trucks with all dimensions (SAME LOGIC)
  vehicles = (vehicles || []).map(v => {
    const copy = { ...v };
    copy.usableLengthFt = Number(copy.usableLengthFt || copy.length || 0);
    copy.usableWidthFt = Number(copy.usableWidthFt || copy.width || 0);
    copy.usableHeightFt = Number(copy.usableHeightFt || copy.height || 0);
    copy.maxWeightKg = Number(copy.maxWeightKg || copy.capacityInKgs || 0);
    copy.cbmCapacity = copy.cbmCapacity && copy.cbmCapacity > 0
      ? Number(copy.cbmCapacity)
      : (copy.usableLengthFt && copy.usableWidthFt && copy.usableHeightFt ? feet3ToCBM(copy.usableLengthFt, copy.usableWidthFt, copy.usableHeightFt) : 0);
    return copy;
  }).sort((a, b) => a.cbmCapacity - b.cbmCapacity);

 // console.log("\n=== Available Trucks (Smallest to Largest) ===");
  vehicles.forEach(v => {
   // console.log(`Truck: ${v.truckName}, CBM: ${v.cbmCapacity}, Weight: ${v.maxWeightKg}kg, Dim: ${v.usableLengthFt}x${v.usableWidthFt}x${v.usableHeightFt}ft`);
  });

  // ✅ Prepare packages (SAME LOGIC)
  let items = pkgs.map(p => {
    const lengthFt = Number(p.lengthFt || p.length || 0);
    const widthFt = Number(p.widthFt || p.width || 0);
    const heightFt = Number(p.heightFt || p.height || 0);
    const cbmVal = (p.cbm && p.cbm > 0) ? Number(p.cbm) : feet3ToCBM(lengthFt, widthFt, heightFt);
    return {
      pkgId: p.pkgId,
      lengthFt,
      widthFt,
      heightFt,
      weightKg: Number(p.weightKg || p.weight || 0),
      stackable: p.stackable !== false,
      cbm: cbmVal,
      qty: Number(p.qty || 1)
    };
  });

 // console.log("\n=== Packages to Allocate ===");
  items.forEach(it => {
  //  console.log(`Pkg: ${it.pkgId}, Size: ${it.lengthFt}x${it.widthFt}x${it.heightFt}ft, CBM: ${it.cbm}, Weight: ${it.weightKg}kg, Qty: ${it.qty}, Stackable: ${it.stackable}`);
  });

  const totalCBM = items.reduce((sum, it) => sum + (it.cbm * it.qty), 0);
  const totalWeight = items.reduce((sum, it) => sum + (it.weightKg * it.qty), 0);
 // console.log(`\n📊 TOTAL REQUIREMENTS: ${totalCBM.toFixed(2)} CBM, ${totalWeight}kg`);

  const allocationsInstances = [];

  // ✅ REALISTIC: Dimension checking with FIXED HEIGHT (SAME LOGIC)
  function canFitSingleUnitInTruck(it, truck) {
    const rotations = [
      [it.lengthFt, it.widthFt, it.heightFt],
      [it.widthFt, it.lengthFt, it.heightFt],
    ];
    
    return rotations.some(([l, w, h]) => 
      l <= truck.usableLengthFt && 
      w <= truck.usableWidthFt && 
      h <= truck.usableHeightFt
    );
  }

  // ✅ COMPLETELY REWRITTEN: REALISTIC MIXED ARRANGEMENT CALCULATION (SAME LOGIC)
  function calculateMaxPhysicalUnits(it, inst, truck) {
    //console.log(`\n🔍 REAL MIXED ARRANGEMENT: ${it.pkgId} (${it.stackable ? 'STACKABLE' : 'NON-STACKABLE'}) in ${inst.truckName}`);
    
    const existingItems = inst.items;
    
    if (it.stackable) {
        return calculateRealStackableWithMixed(it, truck, existingItems);
    } else {
        return calculateRealNonStackableWithMixed(it, truck, existingItems);
    }
  }

  function calculateRealStackableWithMixed(it, truck, existingItems) {
    // Stackable can only share space with other stackable items
    const maxLayers = Math.floor(truck.usableHeightFt / it.heightFt);
    if (maxLayers === 0) return 0;

    let maxUnitsPerLayer = 0;
    const rotations = [
        [it.lengthFt, it.widthFt],
        [it.widthFt, it.lengthFt]
    ];

    // Calculate available floor space considering existing non-stackable items
    let availableLength = truck.usableLengthFt;
    let availableWidth = truck.usableWidthFt;
    
    const existingNonStackable = existingItems.filter(item => !item.stackable);
    if (existingNonStackable.length > 0) {
        // Non-stackable items take up floor space
        const maxNonStackableWidth = Math.max(...existingNonStackable.map(item => 
            Math.min(item.lengthFt, item.widthFt)
        ));
        availableWidth = Math.max(0, truck.usableWidthFt - maxNonStackableWidth);
    }

    for (const [pkgL, pkgW] of rotations) {
        if (pkgL <= availableLength && pkgW <= availableWidth) {
            const unitsInLength = Math.floor(availableLength / pkgL);
            const unitsInWidth = Math.floor(availableWidth / pkgW);
            maxUnitsPerLayer = Math.max(maxUnitsPerLayer, unitsInLength * unitsInWidth);
        }
    }

    // Also check full truck dimensions if no non-stackable items
    if (existingNonStackable.length === 0) {
        for (const [pkgL, pkgW] of rotations) {
            const unitsInLength = Math.floor(truck.usableLengthFt / pkgL);
            const unitsInWidth = Math.floor(truck.usableWidthFt / pkgW);
            maxUnitsPerLayer = Math.max(maxUnitsPerLayer, unitsInLength * unitsInWidth);
        }
    }

    const totalCapacity = maxUnitsPerLayer * maxLayers;
    
    // Only stackable items share the same vertical space
    const existingStackableCount = existingItems
        .filter(item => item.stackable)
        .reduce((sum, item) => sum + item.qty, 0);

    const available = Math.max(0, totalCapacity - existingStackableCount);
    
    //console.log(`   STACKABLE: ${maxUnitsPerLayer} units/layer × ${maxLayers} layers = ${totalCapacity} total`);
    //console.log(`   Existing Stackable: ${existingStackableCount}, Available: ${available}`);
    
    return available;
  }

  function calculateRealNonStackableWithMixed(it, truck, existingItems) {
    // Non-stackable need dedicated floor space, cannot share with other non-stackable
    let maxUnits = 0;
    const rotations = [
        [it.lengthFt, it.widthFt],
        [it.widthFt, it.lengthFt]
    ];

    // Count existing non-stackable items
    const existingNonStackableCount = existingItems
        .filter(item => !item.stackable)
        .reduce((sum, item) => sum + item.qty, 0);

    // Calculate available space considering existing stackable items
    let availableLength = truck.usableLengthFt;
    let availableWidth = truck.usableWidthFt;
    
    const existingStackable = existingItems.filter(item => item.stackable);
    if (existingStackable.length > 0) {
        // Stackable items typically use one side, leaving space for non-stackable
        const maxStackableWidth = Math.max(...existingStackable.map(item => 
            Math.min(item.lengthFt, item.widthFt)
        ));
        availableWidth = Math.max(0, truck.usableWidthFt - maxStackableWidth);
    }

    for (const [pkgL, pkgW] of rotations) {
        if (pkgL <= availableLength && pkgW <= availableWidth) {
            const unitsInLength = Math.floor(availableLength / pkgL);
            const unitsInWidth = Math.floor(availableWidth / pkgW);
            const totalPossible = unitsInLength * unitsInWidth;
            
            const available = Math.max(0, totalPossible - existingNonStackableCount);
            maxUnits = Math.max(maxUnits, available);
        }
    }

    // Also check full truck dimensions if no stackable items
    if (existingStackable.length === 0) {
        for (const [pkgL, pkgW] of rotations) {
            const unitsInLength = Math.floor(truck.usableLengthFt / pkgL);
            const unitsInWidth = Math.floor(truck.usableWidthFt / pkgW);
            const totalPossible = unitsInLength * unitsInWidth;
            
            const available = Math.max(0, totalPossible - existingNonStackableCount);
            maxUnits = Math.max(maxUnits, available);
        }
    }

 // console.log(`   NON-STACKABLE: Max ${maxUnits} units (dedicated floor space)`);
    return maxUnits;
  }

  // ✅ REALISTIC: Maximum units calculation (SAME LOGIC)
  function maxFitUnits(it, inst, remainingQty) {
    const t = inst.truckObj;
    
    if (!canFitSingleUnitInTruck(it, t)) {
       // console.log(`   ❌ Single unit cannot fit`);
        return 0;
    }

    // Volume constraint
    const freeCBM = Math.max(0, t.cbmCapacity - inst.usedCBM);
    const maxByCBM = Math.floor(freeCBM / it.cbm);
    
    // Weight constraint
    const freeWeight = Math.max(0, t.maxWeightKg - inst.usedWeight);
    const maxByWeight = Math.floor(freeWeight / it.weightKg);

    // Physical arrangement constraint
    const maxPhysical = calculateMaxPhysicalUnits(it, inst, t);

    const result = Math.max(0, Math.min(remainingQty, maxByCBM, maxByWeight, maxPhysical));
    
   // console.log(`   📊 Constraints - CBM:${maxByCBM}, Weight:${maxByWeight}, Physical:${maxPhysical} = Final:${result}`);
    
    return result;
  }

  function placeUnits(it, inst, qtyToPlace) {
    if (!qtyToPlace) return;

    inst.usedCBM += it.cbm * qtyToPlace;
    inst.usedWeight += it.weightKg * qtyToPlace;

    const existing = inst.items.find(x => x.pkgId === it.pkgId);
    if (existing) {
        existing.qty += qtyToPlace;
    } else {
        inst.items.push({ ...it, qty: qtyToPlace });
    }
    
    //console.log(`   📦 Placed ${qtyToPlace} ${it.pkgId}`);
  }

  // ✅ IMPROVED: Find realistic truck for items (SAME LOGIC)
  function findBestTruckForItems(remainingItems, usedTruckIds) {
    //console.log(`\n🔍 FINDING REALISTIC TRUCK FOR ${remainingItems.length} ITEMS...`);
    
    const availableTrucks = vehicles.filter(v => !usedTruckIds.includes(v.truckId));
    
    let bestTruck = null;
    let bestScore = -1;

    for (const truck of availableTrucks) {
       // console.log(`   Testing ${truck.truckName}...`);
        
        const tempInstance = {
            truckObj: truck,
            usedCBM: 0,
            usedWeight: 0,
            items: []
        };

        let totalItemsPlaced = 0;
        let realisticAllocation = true;

        // Try to place items with REALISTIC mixed arrangement
        for (const item of remainingItems) {
            const itemCopy = { ...item };
            
            if (!canFitSingleUnitInTruck(itemCopy, truck)) {
                realisticAllocation = false;
                break;
            }

            const canPlace = maxFitUnits(itemCopy, tempInstance, itemCopy.qty);
            
            if (canPlace > 0) {
                // Additional check: mixed arrangement feasibility
                if (!checkMixedArrangementFeasibility(tempInstance, truck)) {
                    realisticAllocation = false;
                    break;
                }
                
                placeUnits(itemCopy, tempInstance, canPlace);
                totalItemsPlaced += canPlace;
            } else {
                realisticAllocation = false;
                break;
            }
        }

        if (!realisticAllocation || totalItemsPlaced === 0) {
           // console.log(`   ❌ Not realistic in ${truck.truckName}`);
            continue;
        }

        // Calculate realistic score
        const cbmUtilization = tempInstance.usedCBM / truck.cbmCapacity;
        const weightUtilization = tempInstance.usedWeight / truck.maxWeightKg;
        const utilizationScore = (cbmUtilization + weightUtilization) / 2;
        
        const score = (totalItemsPlaced * 0.6) + (utilizationScore * 0.4);
        
       // console.log(`   ${truck.truckName} Score: ${score.toFixed(2)} (Items: ${totalItemsPlaced}, Utilization: ${(utilizationScore * 100).toFixed(1)}%)`);

        if (score > bestScore) {
            bestScore = score;
            bestTruck = truck;
        }
    }

    if (bestTruck) {
       // console.log(`   🏆 BEST REALISTIC TRUCK: ${bestTruck.truckName}`);
        return bestTruck;
    }
    
    return null;
  }

  // ✅ NEW: Mixed arrangement feasibility check (SAME LOGIC)
  function checkMixedArrangementFeasibility(instance, truck) {
    const items = instance.items;
    const stackableItems = items.filter(item => item.stackable);
    const nonStackableItems = items.filter(item => !item.stackable);
    
    if (stackableItems.length === 0 || nonStackableItems.length === 0) {
        return true; // Only one type of items, always feasible
    }

    // Check if mixed arrangement is physically possible
    const totalStackable = stackableItems.reduce((sum, item) => sum + item.qty, 0);
    const totalNonStackable = nonStackableItems.reduce((sum, item) => sum + item.qty, 0);
    
    // Simple check: if both types exist, they should be able to share the truck
    const stackableVolume = stackableItems.reduce((sum, item) => sum + (item.cbm * item.qty), 0);
    const nonStackableVolume = nonStackableItems.reduce((sum, item) => sum + (item.cbm * item.qty), 0);
    
    return (stackableVolume + nonStackableVolume) <= truck.cbmCapacity;
  }

// ✅ SIMPLIFIED AND REALISTIC ALLOCATION STRATEGY (FIXED VERSION)
console.log("\n🚛 STARTING REALISTIC ALLOCATION...");

let remainingItems = items.map(it => ({ ...it }));
const optimizedAllocations = [];

// Sort by difficulty (non-stackable first, then by size)
remainingItems.sort((a, b) => {
  if (a.stackable !== b.stackable) return a.stackable ? 1 : -1;
  return (b.lengthFt * b.widthFt * b.heightFt) - (a.lengthFt * a.widthFt * a.heightFt);
});

let safetyCounter = 0;
const MAX_ITERATIONS = vehicles.length * 20;

while (remainingItems.length > 0 && safetyCounter < MAX_ITERATIONS) {
  safetyCounter++;
  
  const currentItem = remainingItems[0];
  if (currentItem.qty <= 0) {
    remainingItems.shift();
    continue;
  }

  console.log(`\n=== ALLOCATING ${currentItem.pkgId} (${currentItem.lengthFt}x${currentItem.widthFt}x${currentItem.heightFt}ft, ${currentItem.qty} remaining) ===`);

  // Try existing trucks first (IMPROVED LOGIC)
  let placedInExisting = false;
  for (const inst of optimizedAllocations) {
    console.log(`   🔍 Checking existing truck: ${inst.truckName}`);
    const canPlace = maxFitUnits(currentItem, inst, currentItem.qty);
    console.log(`   📦 Can place ${canPlace} units in ${inst.truckName}`);
    
    if (canPlace > 0) {
      placeUnits(currentItem, inst, canPlace);
      currentItem.qty -= canPlace;
      placedInExisting = true;
      console.log(`✅ Placed ${canPlace} units in existing ${inst.truckName}`);
      
      if (currentItem.qty <= 0) {
        console.log(`   🎯 Fully allocated in existing truck`);
        break;
      } else {
        console.log(`   🔄 Still ${currentItem.qty} units remaining, continuing...`);
      }
    }
  }

  // If still items remaining, find new truck - CRITICAL FIX: ALLOW SAME TRUCK TYPE MULTIPLE TIMES
  if (currentItem.qty > 0) {
    console.log(`   🔎 Looking for new truck for remaining ${currentItem.qty} units...`);
    
    // ✅ CRITICAL FIX: Don't filter by used truck IDs - allow same truck type multiple times
    const availableTrucks = vehicles; // Use ALL trucks, including same types
    
    console.log(`   🚚 Available trucks: ${availableTrucks.map(t => t.truckName).join(', ')}`);
    
    let bestTruck = null;
    let bestFitQty = 0;

    // Find the best truck that can fit at least some quantity
    for (const truck of availableTrucks) {
      const tempInst = {
        truckObj: truck,
        usedCBM: 0,
        usedWeight: 0,
        items: []
      };

      const canPlace = maxFitUnits(currentItem, tempInst, currentItem.qty);
      console.log(`   🔍 ${truck.truckName} can fit: ${canPlace} units`);
      
      if (canPlace > bestFitQty) {
        bestFitQty = canPlace;
        bestTruck = truck;
      }
    }

    if (bestTruck && bestFitQty > 0) {
      const newInst = {
        truckId: bestTruck.truckId,
        truckName: bestTruck.truckName,
        truckObj: bestTruck,
        usedCBM: 0,
        usedWeight: 0,
        items: []
      };

      const canPlace = maxFitUnits(currentItem, newInst, currentItem.qty);
      if (canPlace > 0) {
        placeUnits(currentItem, newInst, canPlace);
        currentItem.qty -= canPlace;
        optimizedAllocations.push(newInst);
        console.log(`🚛 Created ${bestTruck.truckName} with ${canPlace} units`);
        
        // ✅ After creating new truck, try again in ALL existing trucks
        if (currentItem.qty > 0) {
          console.log(`   🔄 Still ${currentItem.qty} units remaining, checking ALL trucks again...`);
          continue; // Go back to check all trucks again
        }
      }
    } else {
      // ❌ If current item can't fit in any truck (new or existing)
      console.log(`⚠️ ${currentItem.pkgId} (${currentItem.lengthFt}x${currentItem.widthFt}x${currentItem.heightFt}ft) cannot fit in any truck`);
      
      // Final check in all existing trucks
      let canFitAnywhere = false;
      for (const inst of optimizedAllocations) {
        const canPlace = maxFitUnits(currentItem, inst, currentItem.qty);
        if (canPlace > 0) {
          console.log(`   💡 But can fit ${canPlace} units in existing ${inst.truckName}!`);
          placeUnits(currentItem, inst, canPlace);
          currentItem.qty -= canPlace;
          canFitAnywhere = true;
          break;
        }
      }
      
      if (!canFitAnywhere) {
        console.log(`   ❌ Really cannot fit anywhere, skipping to next item`);
        remainingItems.shift(); // Remove current item
      }
    }
  }

  // Remove fully allocated items
  if (currentItem.qty <= 0) {
    remainingItems.shift();
  }
  
  // Safety check
  if (safetyCounter >= MAX_ITERATIONS) {
    console.log("🛑 SAFETY BREAK: Maximum iterations reached");
    break;
  }
}

// Calculate total allocated items
const totalAllocated = items.reduce((total, item) => total + item.qty, 0) - 
                     remainingItems.reduce((total, item) => total + item.qty, 0);

console.log(`\n📊 ALLOCATION SUMMARY: ${totalAllocated}/${items.reduce((total, item) => total + item.qty, 0)} items allocated in ${optimizedAllocations.length} trucks`);

// Update final allocations
allocationsInstances.length = 0;
optimizedAllocations.forEach(inst => allocationsInstances.push(inst));

// Prepare response based on allocation status
if (remainingItems.length > 0) {
  const remainingSummary = remainingItems.map(it => 
    `${it.pkgId} (${it.qty} units, ${it.lengthFt}x${it.widthFt}x${it.heightFt}ft, ${it.weightKg}kg)`
  ).join(', ');
  
  console.log(`\n❌ PARTIAL ALLOCATION: ${remainingSummary} remaining`);
  
  const { totalTruckingChargesInUSD, allocationsStatus } = await processFinalAllocations({
    allocationsInstances,
    remainingPkgs: remainingItems,
    client,
    vehicles
  });

  if (allocationsStatus) return allocationsStatus;

  return {
    status: "partial-success",
    message: `Partially allocated. ${totalAllocated}/${items.reduce((total, item) => total + item.qty, 0)} items in ${optimizedAllocations.length} trucks. ${remainingItems.length} items remaining.`,
    allocations: allocationsInstances.map(inst => ({
      truckId: inst.truckId,
      truckName: inst.truckName,
      items: inst.items.map(it => ({ pkgId: it.pkgId, qty: it.qty })),
      totalItems: inst.items.reduce((sum, item) => sum + item.qty, 0),
      usedCBM: Number(inst.usedCBM.toFixed(6)),
      usedWeightKg: inst.usedWeight,
      capacityCBM: inst.truckObj.cbmCapacity,
      capacityWeight: inst.truckObj.maxWeightKg,
      cbmUtilization: `${((inst.usedCBM / inst.truckObj.cbmCapacity) * 100).toFixed(1)}%`,
      weightUtilization: `${((inst.usedWeight / inst.truckObj.maxWeightKg) * 100).toFixed(1)}%`
    })),
    remainingItems: remainingItems,
    totalAllocated: totalAllocated,
    totalRequired: items.reduce((total, item) => total + item.qty, 0),
    totalTruckingChargesInUSD: totalTruckingChargesInUSD || 0
  };
}

// SUCCESS CASE: All items allocated
console.log("\n" + "=".repeat(50));
console.log("🎯 FINAL REALISTIC ALLOCATION - SUCCESS");
console.log("=".repeat(50));

const aggregated = allocationsInstances.map(inst => ({
  truckId: inst.truckId,
  truckName: inst.truckName,
  items: inst.items.map(it => ({ pkgId: it.pkgId, qty: it.qty })),
  totalItems: inst.items.reduce((sum, item) => sum + item.qty, 0),
  usedCBM: Number(inst.usedCBM.toFixed(6)),
  usedWeightKg: inst.usedWeight,
  capacityCBM: inst.truckObj.cbmCapacity,
  capacityWeight: inst.truckObj.maxWeightKg,
  cbmUtilization: `${((inst.usedCBM / inst.truckObj.cbmCapacity) * 100).toFixed(1)}%`,
  weightUtilization: `${((inst.usedWeight / inst.truckObj.maxWeightKg) * 100).toFixed(1)}%`
}));

aggregated.forEach(alloc => {
  console.log(`\n🚛 ${alloc.truckName}:`);
  console.log(`   📦 ${alloc.items.map(it => `${it.pkgId}×${it.qty}`).join(', ')}`);
  console.log(`   📊 ${alloc.usedCBM}CBM / ${alloc.capacityCBM}CBM (${alloc.cbmUtilization})`);
  console.log(`   ⚖️  ${alloc.usedWeightKg}kg / ${alloc.capacityWeight}kg (${alloc.weightUtilization})`);
});

// ✅ Call finalization helper with CLEAN parameters
const { totalTruckingChargesInUSD, allocationsStatus } = await processFinalAllocations({
  allocationsInstances,
  remainingPkgs: [],
  client,
  vehicles
});

if (allocationsStatus) return allocationsStatus;

return {
  status: "success",
  message: `All packages allocated realistically in ${aggregated.length} trucks`,
  allocations: aggregated,
  totalTruckingChargesInUSD: totalTruckingChargesInUSD || 0
};
}

module.exports = { allocateTrucksAndPrice };