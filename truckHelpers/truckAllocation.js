//truckHelpers/truckAllocation.js
 const { processFinalAllocations } = require('./truckAllocationHelpers');
const Simple3DSpace = require('./Simple3DSpace');

async function allocateTrucksAndPrice({
  client,
  pkgs,
  vehicles,
  persist,
  recordId,
  userId
}) {

  if (!pkgs || !pkgs.length) return { status: "no-packages", message: "No packages to allocate", allocations: [] };

  let oversizedPackages = [];
  let overweightPackages = [];
  let validPackages = [];

  // Prepare trucks
  vehicles = (vehicles || []).map(v => {
    const copy = { ...v };
    copy.usableLengthFt = Number(copy.usableLengthFt || copy.length || 0);
    copy.usableWidthFt = Number(copy.usableWidthFt || copy.width || 0);
    copy.usableHeightFt = Number(copy.usableHeightFt || copy.height || 0);
    copy.maxWeightKg = Number(copy.maxWeightKg || copy.capacityInKgs || 0);
    copy.cbmCapacity = copy.cbmCapacity && copy.cbmCapacity > 0
      ? Number(copy.cbmCapacity)
      : (copy.usableLengthFt && copy.usableWidthFt && copy.usableHeightFt ? Simple3DSpace.feet3ToCBM(copy.usableLengthFt, copy.usableWidthFt, copy.usableHeightFt) : 0);
    return copy;
  }).sort((a, b) => a.cbmCapacity - b.cbmCapacity);

  console.log("\n=== Available Trucks (Smallest to Largest) ===");
  vehicles.forEach(v => {
    console.log(`Truck: ${v.truckName}, CBM: ${v.cbmCapacity}, Weight: ${v.maxWeightKg}kg, Dim: ${v.usableLengthFt}x${v.usableWidthFt}x${v.usableHeightFt}ft`);
  });

  // Validate packages
  const maxTruckLength = Math.max(...vehicles.map(v => v.usableLengthFt));
  const maxTruckWeight = Math.max(...vehicles.map(v => v.maxWeightKg));

  for (const pkg of pkgs) {
    const lengthFt = Number(pkg.lengthFt || pkg.length || 0);
    const widthFt = Number(pkg.widthFt || pkg.width || 0);
    const heightFt = Number(pkg.heightFt || pkg.height || 0);
    const weightKg = Number(pkg.weightKg || pkg.weight || 0);

    let isValid = true;

    // Check dimensions
    const maxDimension = Math.max(lengthFt, widthFt, heightFt);
    const minDimension = Math.min(lengthFt, widthFt, heightFt);
    
    if (maxDimension > maxTruckLength || minDimension <= 0) {
      oversizedPackages.push({
        pkgId: pkg.pkgId,
        dimensions: `${lengthFt}x${widthFt}x${heightFt}ft`,
        issue: maxDimension > maxTruckLength ? 
               `Package too large (${maxDimension}ft > max truck ${maxTruckLength}ft)` :
               `Invalid dimensions`
      });
      isValid = false;
    }

    // // Check weight
    // if (weightKg > maxTruckWeight) {
    //   overweightPackages.push({
    //     pkgId: pkg.pkgId,
    //     weight: `${weightKg}kg`,
    //     maxWeight: `${maxTruckWeight}kg`,
    //     note: "Package too heavy"
    //   });
    //   isValid = false;
    // }

    if (isValid) {
      validPackages.push(pkg);
    }
  }

  if (validPackages.length === 0) {
    return {
      status: "validation-failed",
      message: "No packages can be allocated",
      oversizedPackages,
      overweightPackages,
      allocations: []
    };
  }

  // Prepare items
  let items = validPackages.map(p => {
    const lengthFt = Number(p.lengthFt || p.length || 0);
    const widthFt = Number(p.widthFt || p.width || 0);
    const heightFt = Number(p.heightFt || p.height || 0);
    const cbmVal = (p.cbm && p.cbm > 0) ? Number(p.cbm) : Simple3DSpace.feet3ToCBM(lengthFt, widthFt, heightFt);
    return {
      pkgId: p.pkgId,
      lengthFt,
      widthFt,
      heightFt,
      weightKg: Number(p.weightKg || p.weight || 0) / Math.max(1, Number(p.qty || 1)),
      stackable: p.stackable !== false,
      cbm: cbmVal,
      qty: Number(p.qty || 1),
      originalWeight: Number(p.weightKg || p.weight || 0) // Store total weight
    };
  });

  console.log("\n=== Packages to Allocate ===");
  items.forEach(it => {
    console.log(`Pkg: ${it.pkgId}, Size: ${it.lengthFt}x${it.widthFt}x${it.heightFt}ft, CBM: ${it.cbm}, Weight: ${it.weightKg}kg, Qty: ${it.qty}, Stackable: ${it.stackable}`);
  });

  // ✅ SIMPLE CHECK: Can single unit fit in truck
  function canSingleUnitFit(pkg, truck) {
    // Check both rotations (length↔width, height FIXED)
    return (pkg.lengthFt <= truck.usableLengthFt && pkg.widthFt <= truck.usableWidthFt && pkg.heightFt <= truck.usableHeightFt) ||
           (pkg.widthFt <= truck.usableLengthFt && pkg.lengthFt <= truck.usableWidthFt && pkg.heightFt <= truck.usableHeightFt);
  }

 function calculate3DFit(pkg, truck, existingItems = [], existingSpace3D = null) {
  // ✅ USE ACTUAL space3D from truck allocation
  if (existingSpace3D) {
    // Clone the space to test
    const tempSpace = new Simple3DSpace(truck);
    tempSpace.placedBoxes = [...existingSpace3D.placedBoxes];
    tempSpace.totalCBM = existingSpace3D.totalCBM;
    tempSpace.totalWeight = existingSpace3D.totalWeight;
    tempSpace.itemsList = [...existingSpace3D.itemsList];
    
    return tempSpace.calculateMaxFit(pkg, pkg.qty);
  }
  
  // Fallback: old logic (for backward compatibility)
  const space = new Simple3DSpace(truck);
  return space.calculateMaxFit(pkg, pkg.qty);
}

  // ✅ Place units in truck
  function placeInTruck(pkg, truckInstance, qtyToPlace) {
    if (!truckInstance.space3D) {
      truckInstance.space3D = new Simple3DSpace(truckInstance.truckObj);
    }
    
    let placed = 0;
    for (let i = 0; i < qtyToPlace; i++) {
      const position = truckInstance.space3D.findBestPosition(pkg);
      if (!position) break;
      
      // Check constraints
      if (truckInstance.space3D.totalCBM + pkg.cbm > truckInstance.truckObj.cbmCapacity) break;
      if (truckInstance.space3D.totalWeight + pkg.weightKg > truckInstance.truckObj.maxWeightKg) break;
      
      truckInstance.space3D.placeBox(pkg, position.x, position.y, position.z,
                                    position.length, position.width, position.height);
      placed++;
    }
    
    // Update legacy fields
    truckInstance.usedCBM = truckInstance.space3D.getUsedCBM();
    truckInstance.usedWeight = truckInstance.space3D.getUsedWeight();
    
    // Update items list
    const existingItem = truckInstance.items.find(it => it.pkgId === pkg.pkgId);
    if (existingItem) {
      existingItem.qty += placed;
    } else if (placed > 0) {
      truckInstance.items.push({ ...pkg, qty: placed });
    }
    
    return placed;
  }

 // Group packages by dimensions
const packageGroups = {};
items.forEach(pkg => {
  const key = `${pkg.lengthFt}_${pkg.widthFt}_${pkg.heightFt}_${pkg.weightKg}_${pkg.stackable}`;
  
  if (!packageGroups[key]) {
    packageGroups[key] = {
      pkgId: pkg.pkgId, // First package ID
      lengthFt: pkg.lengthFt,
      widthFt: pkg.widthFt,
      heightFt: pkg.heightFt,
      weightKg: pkg.weightKg,
      stackable: pkg.stackable,
      cbm: pkg.cbm,
      qty: 0,
      originalPkgIds: []
    };
  }
  
  packageGroups[key].qty += pkg.qty;
  packageGroups[key].originalPkgIds.push(pkg.pkgId);
});

// Create combined remainingItems array
let remainingItems = Object.values(packageGroups);
  const allocations = [];

  // ✅ MODIFIED: Sort by DIMENSION (largest length first), then stackable
remainingItems.sort((a, b) => {
  // First by maximum dimension (largest first)
  const aMaxDim = Math.max(a.lengthFt, a.widthFt, a.heightFt);
  const bMaxDim = Math.max(b.lengthFt, b.widthFt, b.heightFt);
  if (bMaxDim !== aMaxDim) return bMaxDim - aMaxDim;
  
  // Then by whether it's non-stackable (non-stackable first)
  if (a.stackable !== b.stackable) return a.stackable ? 1 : -1;
  
  // Then by volume
  return (b.lengthFt * b.widthFt * b.heightFt) - (a.lengthFt * a.widthFt * a.heightFt);
});

  // Allocate each package type
  for (const currentItem of remainingItems) {
    let remainingQty = currentItem.qty;
    
    console.log(`\n=== ALLOCATING ${currentItem.pkgId} (${remainingQty} units) ===`);

    // Try existing trucks first
    for (const alloc of allocations) {
      if (remainingQty <= 0) break;
      
      // Check if single unit fits
      if (!canSingleUnitFit(currentItem, alloc.truckObj)) continue;
      
     // ✅ PASS THE ACTUAL space3D OBJECT
  const canFit = calculate3DFit(currentItem, alloc.truckObj, alloc.items, alloc.space3D);
  
  if (canFit > 0) {
    const toPlace = Math.min(canFit, remainingQty);
    const placed = placeInTruck(currentItem, alloc, toPlace);
    remainingQty -= placed;
    console.log(`   ✅ Placed ${placed} units in existing ${alloc.truckName}`);
  }
}

    // Create new trucks for remaining
    while (remainingQty > 0) {
      console.log(`   🔎 Need new truck for ${remainingQty} units`);
      
      let bestTruck = null;
      let maxFit = 0;
      
      // Find best truck
      for (const truck of vehicles) {
        if (!canSingleUnitFit(currentItem, truck)) continue;
        
        const tempSpace = new Simple3DSpace(truck);
        const fit = tempSpace.calculateMaxFit(currentItem, remainingQty);
        
        if (fit > maxFit) {
          maxFit = fit;
          bestTruck = truck;
        }
      }
      
      if (!bestTruck) {
        console.log(`   ❌ No truck can fit ${currentItem.pkgId}`);
        break;
      }
      
      // Create new allocation
      const newAlloc = {
        truckId: bestTruck.truckId,
        truckName: bestTruck.truckName,
        truckObj: bestTruck,
        usedCBM: 0,
        usedWeight: 0,
        items: [],
        space3D: new Simple3DSpace(bestTruck)
      };
      
      const toPlace = Math.min(maxFit, remainingQty);
      const placed = placeInTruck(currentItem, newAlloc, toPlace);
      remainingQty -= placed;
      allocations.push(newAlloc);
      
      console.log(`   🚛 Created ${bestTruck.truckName} with ${placed} units`);
    }
    
    // Update remaining quantity
    currentItem.qty = remainingQty;
  }

  // Calculate totals
  const totalAllocated = allocations.reduce((total, alloc) => {
    return total + alloc.items.reduce((sum, item) => sum + (item.qty || 0), 0);
  }, 0);

  const totalRequired = items.reduce((total, item) => total + (item.qty || 0), 0);

  console.log(`\n📊 ALLOCATION SUMMARY: ${totalAllocated}/${totalRequired} items allocated in ${allocations.length} trucks`);

  // Filter out empty allocations and items
  const validAllocations = allocations.filter(alloc => alloc.items.length > 0);
  
  // Prepare response
  const unallocatedItems = remainingItems.filter(item => item.qty > 0);
  
  if (unallocatedItems.length > 0) {
    console.log(`\n❌ PARTIAL ALLOCATION: ${unallocatedItems.length} items remaining`);
    
    const { allocationsStatus } = await processFinalAllocations({
      allocationsInstances: validAllocations,
      remainingPkgs: unallocatedItems,
      client,
      vehicles
    });

    if (allocationsStatus) {
      return allocationsStatus;
    }

    return {
      status: "partial-success",
      message: `Partially allocated ${totalAllocated}/${totalRequired} items`,
      allocations: validAllocations.map(alloc => ({
        truckId: alloc.truckId,
        truckName: alloc.truckName,
        items: alloc.items.map(it => ({ pkgId: it.pkgId, qty: it.qty })),
        totalItems: alloc.items.reduce((sum, item) => sum + item.qty, 0),
        usedCBM: Number(alloc.usedCBM.toFixed(6)),
        usedWeightKg: alloc.usedWeight,
        capacityCBM: alloc.truckObj.cbmCapacity,
        capacityWeight: alloc.truckObj.maxWeightKg,
        cbmUtilization: `${((alloc.usedCBM / alloc.truckObj.cbmCapacity) * 100).toFixed(1)}%`,
        weightUtilization: `${((alloc.usedWeight / alloc.truckObj.maxWeightKg) * 100).toFixed(1)}%`
      })),
      remainingItems: unallocatedItems,
      totalAllocated,
      totalRequired,
      totalTruckingChargesInUSD: totalTruckingChargesInUSD || 0
    };
  }
  validAllocations.forEach(alloc => {
    console.log(`\n🚛 ${alloc.truckName}:`);
    console.log(`   📦 ${alloc.items.map(it => `${it.pkgId}×${it.qty}`).join(', ')}`);
    console.log(`   📊 ${alloc.usedCBM.toFixed(3)}CBM / ${alloc.truckObj.cbmCapacity}CBM (${((alloc.usedCBM / alloc.truckObj.cbmCapacity) * 100).toFixed(1)}%)`);
    console.log(`   ⚖️  ${alloc.usedWeight.toFixed(1)}kg / ${alloc.truckObj.maxWeightKg}kg (${((alloc.usedWeight / alloc.truckObj.maxWeightKg) * 100).toFixed(1)}%)`);
  });

  const { allocationsStatus } = await processFinalAllocations({
    allocationsInstances: validAllocations,
    remainingPkgs: [],
    client,
    vehicles
  });

  if (allocationsStatus) {
    return allocationsStatus;
  }
}

module.exports = { allocateTrucksAndPrice };