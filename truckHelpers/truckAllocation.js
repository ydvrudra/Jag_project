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
  userId,
  hdr
}) {

  const fromLocationId = hdr?.FromPinCodeId || 0;
  const toLocationId = hdr?.ToLocationRouteId || 0;

  if (!pkgs || !pkgs.length) return { status: "no-packages", message: "No packages to allocate", allocations: [] };

  // ✅ DECLARE VARIABLES AT FUNCTION LEVEL
  let oversizedPackages = [];
  let overweightPackages = [];
  let validPackages = [];

  // ✅ Prepare trucks with all dimensions
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

  console.log("\n=== Available Trucks (Smallest to Largest) ===");
  vehicles.forEach(v => {
    console.log(`Truck: ${v.truckName}, CBM: ${v.cbmCapacity}, Weight: ${v.maxWeightKg}kg, Dim: ${v.usableLengthFt}x${v.usableWidthFt}x${v.usableHeightFt}ft`);
  });

  // ✅ NEW: Check if any package exceeds maximum truck dimensions
  const maxTruckLength = Math.max(...vehicles.map(v => v.usableLengthFt));
  const maxTruckWidth = Math.max(...vehicles.map(v => v.usableWidthFt));
  const maxTruckHeight = Math.max(...vehicles.map(v => v.usableHeightFt));
  const maxTruckWeight = Math.max(...vehicles.map(v => v.maxWeightKg));

  // ✅ RESET VARIABLES
  oversizedPackages = [];
  overweightPackages = [];
  validPackages = [];

  // Separate valid and invalid packages
  for (const pkg of pkgs) {
    const lengthFt = Number(pkg.lengthFt || pkg.length || 0);
    const widthFt = Number(pkg.widthFt || pkg.width || 0);
    const heightFt = Number(pkg.heightFt || pkg.height || 0);
    const weightKg = Number(pkg.weightKg || pkg.weight || 0);

    let isValid = true;

    // Check dimensions
    const minDimension = Math.min(lengthFt, widthFt, heightFt);
    const maxDimension = Math.max(lengthFt, widthFt, heightFt);
    
    if (maxDimension > maxTruckLength || minDimension <= 0) {
      oversizedPackages.push({
        pkgId: pkg.pkgId,
        dimensions: `${lengthFt}x${widthFt}x${heightFt}ft`,
        issue: maxDimension > maxTruckLength ? 
               `Package too large (${maxDimension}ft > max truck ${maxTruckLength}ft)` :
               `Invalid dimensions (${lengthFt}x${widthFt}x${heightFt}ft)`
      });
      isValid = false;
    }

    // Check weight - DIRECT TOTAL WEIGHT (NO MULTIPLY)
    if (weightKg > maxTruckWeight) {
      overweightPackages.push({
        pkgId: pkg.pkgId,
        weight: `${weightKg}kg`,
        maxWeight: `${maxTruckWeight}kg`,
        note: "Total package weight exceeds truck capacity"
      });
      isValid = false;
    }

    // Add to valid packages if no issues
    if (isValid) {
      validPackages.push(pkg);
    }
  }

  // ✅ Show warnings but continue with valid packages
  if (oversizedPackages.length > 0 || overweightPackages.length > 0) {
    console.log("\n⚠️  PACKAGE VALIDATION WARNINGS:");
    
    if (oversizedPackages.length > 0) {
      console.log("   📦 Oversized Packages (Skipped):");
      oversizedPackages.forEach(p => console.log(`      ${p.pkgId}: ${p.dimensions} - ${p.issue}`));
    }
    
    if (overweightPackages.length > 0) {
      console.log("   ⚖️  Overweight Packages (Skipped):");
      overweightPackages.forEach(p => console.log(`      ${p.pkgId}: ${p.weight} > max ${p.maxWeight}`));
    }

    console.log(`\n✅ Continuing allocation with ${validPackages.length} valid packages`);
  }

  // ✅ If no valid packages, return error
  if (validPackages.length === 0) {
    return {
      status: "validation-failed",
      message: "No packages can be allocated due to size or weight constraints",
      oversizedPackages,
      overweightPackages,
      maxTruckDimensions: {
        length: maxTruckLength,
        width: maxTruckWidth,
        height: maxTruckHeight,
        weight: maxTruckWeight
      },
      allocations: []
    };
  }

  console.log("\n✅ All valid packages are within truck capacity limits");

  // ✅ Prepare ONLY VALID packages
  let items = validPackages.map(p => {
    const lengthFt = Number(p.lengthFt || p.length || 0);
    const widthFt = Number(p.widthFt || p.width || 0);
    const heightFt = Number(p.heightFt || p.height || 0);
    const cbmVal = (p.cbm && p.cbm > 0) ? Number(p.cbm) : feet3ToCBM(lengthFt, widthFt, heightFt);
    return {
      pkgId: p.pkgId,
      lengthFt,
      widthFt,
      heightFt,
     weightKg: Number(p.weightKg || p.weight || 0) / Math.max(1, Number(p.qty || 1)), // ✅ DIRECT TOTAL WEIGHT (NO MULTIPLY)
      stackable: p.stackable !== false,
      cbm: cbmVal,
      qty: Number(p.qty || 1)
    };
  });

  // console.log("\n=== Packages to Allocate ===");
  items.forEach(it => {
  //  console.log(`Pkg: ${it.pkgId}, Size: ${it.lengthFt}x${it.widthFt}x${it.heightFt}ft, CBM: ${it.cbm}, Weight: ${it.weightKg}kg, Qty: ${it.qty}, Stackable: ${it.stackable}`);
  });

  const allocationsInstances = [];

  // ✅ REALISTIC: Dimension checking with FIXED HEIGHT
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

  // ✅ COMPLETELY REWRITTEN: REALISTIC MIXED ARRANGEMENT CALCULATION
  function calculateMaxPhysicalUnits(it, inst, truck) {
    const existingItems = inst.items;
    
    if (it.stackable) {
        return calculateRealStackableWithMixed(it, truck, existingItems);
    } else {
        return calculateRealNonStackableWithMixed(it, truck, existingItems);
    }
  }

  function calculateRealStackableWithMixed(it, truck, existingItems) {
    console.log(`   📦 STACKABLE ARRANGEMENT: ${it.pkgId} in ${truck.truckName}`);
    
    // ❌ STACKABLE CANNOT be placed on NON-STACKABLE
    const existingNonStackable = existingItems.filter(item => !item.stackable);
    
    // Calculate available floor space (excluding non-stackable area)
    let availableFloorWidth = truck.usableWidthFt;
    for (const nonStackItem of existingNonStackable) {
        const itemWidth = Math.min(nonStackItem.lengthFt, nonStackItem.widthFt);
        availableFloorWidth -= itemWidth;
    }
    
    if (availableFloorWidth <= 0) {
        console.log(`   ❌ No floor space available for stackable`);
        return 0;
    }

    // Stackable can be on FLOOR or on top of OTHER STACKABLE
    const maxLayers = Math.floor(truck.usableHeightFt / it.heightFt);
    if (maxLayers === 0) return 0;

    let maxUnitsPerLayer = 0;
    const rotations = [
        [it.lengthFt, it.widthFt],
        [it.widthFt, it.lengthFt]
    ];

    for (const [pkgL, pkgW] of rotations) {
        if (pkgL <= truck.usableLengthFt && pkgW <= availableFloorWidth) {
            const unitsInLength = Math.floor(truck.usableLengthFt / pkgL);
            const unitsInWidth = Math.floor(availableFloorWidth / pkgW);
            maxUnitsPerLayer = Math.max(maxUnitsPerLayer, unitsInLength * unitsInWidth);
        }
    }

    const totalCapacity = maxUnitsPerLayer * maxLayers;
    
    const existingStackableCount = existingItems
        .filter(item => item.stackable)
        .reduce((sum, item) => sum + item.qty, 0);

    const available = Math.max(0, totalCapacity - existingStackableCount);
    
    console.log(`   STACKABLE: ${maxUnitsPerLayer} units/layer × ${maxLayers} layers = ${available} available`);
    return available;
  }

  function calculateRealNonStackableWithMixed(it, truck, existingItems) {
    console.log(`   📦 NON-STACKABLE ARRANGEMENT: ${it.pkgId} in ${truck.truckName}`);
    
    // ✅ CORRECTED: NON-STACKABLE can ONLY be on FLOOR, NOT on stackable
    let maxUnits = 0;
    const rotations = [
        [it.lengthFt, it.widthFt],
        [it.widthFt, it.lengthFt]
    ];

    // Calculate available floor space (excluding space used by existing items)
    let availableFloorWidth = truck.usableWidthFt;
    
    // Subtract space used by existing non-stackable items
    const existingNonStackable = existingItems.filter(item => !item.stackable);
    for (const nonStackItem of existingNonStackable) {
        const itemWidth = Math.min(nonStackItem.lengthFt, nonStackItem.widthFt);
        availableFloorWidth -= itemWidth;
    }
    
    // Also subtract space used by existing stackable items (they use floor space too)
    const existingStackable = existingItems.filter(item => item.stackable);
    for (const stackItem of existingStackable) {
        const itemWidth = Math.min(stackItem.lengthFt, stackItem.widthFt);
        availableFloorWidth -= itemWidth;
    }

    console.log(`   📊 Available floor width for non-stackable: ${availableFloorWidth}ft`);

    for (const [pkgL, pkgW] of rotations) {
        if (pkgL <= truck.usableLengthFt && pkgW <= availableFloorWidth) {
            const unitsInLength = Math.floor(truck.usableLengthFt / pkgL);
            const unitsInWidth = Math.floor(availableFloorWidth / pkgW);
            maxUnits = Math.max(maxUnits, unitsInLength * unitsInWidth);
        }
    }

    console.log(`   NON-STACKABLE: Max ${maxUnits} units (ONLY on floor)`);
    return maxUnits;
  }

  // ✅ REALISTIC: Maximum units calculation
  function maxFitUnits(it, inst, remainingQty) {
    const t = inst.truckObj;
    
    if (!canFitSingleUnitInTruck(it, t)) {
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
  }

  // ✅ SIMPLIFIED AND REALISTIC ALLOCATION STRATEGY
  console.log("\n🚛 STARTING REALISTIC ALLOCATION...");

  let remainingItems = items.map(it => ({ ...it }));
  const optimizedAllocations = [];

  function tryMixedAllocationInExistingTrucks() {
    console.log(`\n🔄 TRYING MIXED ALLOCATION IN EXISTING TRUCKS...`);
    
    for (const inst of optimizedAllocations) {
      const truck = inst.truckObj;
      
      const remainingNonZero = remainingItems.filter(item => item.qty > 0);
      if (remainingNonZero.length === 0) break;
      
      console.log(`   🔍 Checking ${truck.truckName} for mixed packages...`);
      
      let canFitMixed = true;
      let tempInstance = {
        truckObj: truck,
        usedCBM: inst.usedCBM,
        usedWeight: inst.usedWeight,
        items: [...inst.items]
      };
      
      // Try to place all remaining items
      for (const item of remainingNonZero) {
        const canPlace = maxFitUnits(item, tempInstance, item.qty);
        console.log(`      ${item.pkgId}: can place ${canPlace} units`);
        if (canPlace === 0) {
          canFitMixed = false;
          break;
        }
      }
      
      if (canFitMixed) {
        console.log(`   🎯 MIXED ALLOCATION SUCCESS: Adding remaining items to ${truck.truckName}`);
        for (const item of remainingNonZero) {
          const canPlace = maxFitUnits(item, inst, item.qty);
          if (canPlace > 0) {
            placeUnits(item, inst, canPlace);
            item.qty -= canPlace;
            console.log(`      ✅ Placed ${canPlace} ${item.pkgId} in ${truck.truckName}`);
          }
        }
        return true;
      }
    }
    
    console.log(`   ❌ No mixed allocation possible in existing trucks`);
    return false;
  }

  // ✅ CORRECT SEQUENCE - Stackable pehle
  remainingItems.sort((a, b) => {
    if (a.stackable !== b.stackable) return a.stackable ? -1 : 1;
    return (b.lengthFt * b.widthFt * b.heightFt) - (a.lengthFt * a.widthFt * a.heightFt);
  });

  console.log("\n🔀 SORTED PACKAGES ORDER:");
  remainingItems.forEach((item, index) => {
    console.log(`   ${index + 1}. ${item.pkgId} - ${item.stackable ? 'STACKABLE' : 'NON-STACKABLE'} - ${item.lengthFt}x${item.widthFt}x${item.heightFt}ft`);
  });

  let safetyCounter = 0;
  const MAX_ITERATIONS = vehicles.length * 20;

  while (remainingItems.length > 0 && safetyCounter < MAX_ITERATIONS) {
    safetyCounter++;
    
    // ✅ FIRST: Try mixed allocation in existing trucks
    const mixedAllocated = tryMixedAllocationInExistingTrucks();
    if (mixedAllocated) {
      remainingItems = remainingItems.filter(item => item.qty > 0);
      console.log(`🔄 Mixed allocation done, remaining items: ${remainingItems.length}`);
      continue;
    }
    
    const currentItem = remainingItems[0];
    if (currentItem.qty <= 0) {
      remainingItems.shift();
      continue;
    }

    console.log(`\n=== ALLOCATING ${currentItem.pkgId} (${currentItem.lengthFt}x${currentItem.widthFt}x${currentItem.heightFt}ft, ${currentItem.qty} remaining) ===`);

    // Try existing trucks first
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

    // If still items remaining, find new truck
    if (currentItem.qty > 0) {
      console.log(`   🔎 Looking for new truck for remaining ${currentItem.qty} units...`);
      
      const availableTrucks = vehicles;
      
      console.log(`   🚚 Available trucks: ${availableTrucks.map(t => t.truckName).join(', ')}`);
      
      let bestTruck = null;
      let bestFitQty = 0;

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
          
          if (currentItem.qty > 0) {
            console.log(`   🔄 Still ${currentItem.qty} units remaining, checking ALL trucks again...`);
            continue;
          }
        }
      } else {
        console.log(`⚠️ ${currentItem.pkgId} cannot fit in any truck`);
        remainingItems.shift();
      }
    }

    if (currentItem.qty <= 0) {
      remainingItems.shift();
    }
    
    if (safetyCounter >= MAX_ITERATIONS) {
      console.log("🛑 SAFETY BREAK: Maximum iterations reached");
      break;
    }
  }

  const totalAllocated = items.reduce((total, item) => total + item.qty, 0) - 
                       remainingItems.reduce((total, item) => total + item.qty, 0);

  console.log(`\n📊 ALLOCATION SUMMARY: ${totalAllocated}/${items.reduce((total, item) => total + item.qty, 0)} items allocated in ${optimizedAllocations.length} trucks`);

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
      vehicles,
      fromLocationId,    // ✅ USE EXTRACTED DATA
      toLocationId 
    });

    if (allocationsStatus) {
      // ✅ ADD SKIPPED PACKAGES TO PARTIAL ALLOCATION STATUS
      const finalResult = allocationsStatus;
      
      if (oversizedPackages.length > 0 || overweightPackages.length > 0) {
        finalResult.skippedPackages = {
          oversizedPackages,
          overweightPackages
        };
      }
      
      return finalResult;
    }

    const partialResponse = {
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

    // ✅ ADD SKIPPED PACKAGES TO PARTIAL RESPONSE
    if (oversizedPackages.length > 0 || overweightPackages.length > 0) {
      partialResponse.skippedPackages = {
        oversizedPackages,
        overweightPackages
      };
      
      const skippedCount = oversizedPackages.length + overweightPackages.length;
      partialResponse.message += ` ${skippedCount} packages skipped due to size/weight constraints.`;
    }

    return partialResponse;
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

  // ✅ Call finalization helper
  const { totalTruckingChargesInUSD, allocationsStatus } = await processFinalAllocations({
    allocationsInstances,
    remainingPkgs: remainingItems,
    client,
    vehicles,
    fromLocationId: hdr.FromPinCodeId,    
    toLocationId: hdr.ToLocationRouteId   
  });

  if (allocationsStatus) {
    // ✅ ADD SKIPPED PACKAGES TO ALLOCATIONS STATUS
    const finalResult = allocationsStatus;
    
    if (oversizedPackages.length > 0 || overweightPackages.length > 0) {
      finalResult.skippedPackages = {
        oversizedPackages,
        overweightPackages
      };
      
      const skippedCount = oversizedPackages.length + overweightPackages.length;
      if (finalResult.message) {
        finalResult.message += ` ${skippedCount} packages skipped due to size/weight constraints.`;
      }
    }
    
    return finalResult;
  }

  // ✅ FINAL RESPONSE WITH SKIPPED PACKAGES INFO
  const finalResponse = {
    status: "success",
    message: `All packages allocated realistically in ${aggregated.length} trucks`,
    allocations: aggregated,
    totalTruckingChargesInUSD: totalTruckingChargesInUSD || 0
  };

  // ✅ ADD SKIPPED PACKAGES INFO IF ANY
  if (oversizedPackages.length > 0 || overweightPackages.length > 0) {
    finalResponse.skippedPackages = {
      oversizedPackages,
      overweightPackages
    };
    
    const skippedCount = oversizedPackages.length + overweightPackages.length;
    finalResponse.message = `${aggregated.length} trucks allocated. ${skippedCount} packages skipped due to size/weight constraints.`;
    
    console.log(`\n📋 SKIPPED PACKAGES SUMMARY:`);
    if (oversizedPackages.length > 0) {
      console.log(`   📦 Oversized: ${oversizedPackages.map(p => p.pkgId).join(', ')}`);
    }
    if (overweightPackages.length > 0) {
      console.log(`   ⚖️  Overweight: ${overweightPackages.map(p => p.pkgId).join(', ')}`);
    }
  }

  return finalResponse;
}

module.exports = { allocateTrucksAndPrice };