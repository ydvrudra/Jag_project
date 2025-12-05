// truckHelpers/AllocationStrategy.js
const Simple3DSpace = require('./Simple3DSpace');

async function tryAllocationStrategy(strategyName, sortedVehicles, items, truckRatesMap) {
  
  const packageGroups = {};
  items.forEach(pkg => {
    const key = `${pkg.lengthFt}_${pkg.widthFt}_${pkg.heightFt}_${pkg.weightKg}_${pkg.stackable}`;
    if (!packageGroups[key]) {
      packageGroups[key] = { ...pkg, qty: 0, originalPkgIds: [] };
    }
    packageGroups[key].qty += pkg.qty;
    packageGroups[key].originalPkgIds.push(pkg.pkgId);
  });
  
  let remainingItems = Object.values(packageGroups);
  const allocations = [];
  
  // Sort packages (same as before)
  remainingItems.sort((a, b) => {
    const aMaxDim = Math.max(a.lengthFt, a.widthFt, a.heightFt);
    const bMaxDim = Math.max(b.lengthFt, b.widthFt, b.heightFt);
    if (bMaxDim !== aMaxDim) return bMaxDim - aMaxDim;
    if (a.stackable !== b.stackable) return a.stackable ? 1 : -1;
    return (b.lengthFt * b.widthFt * b.heightFt) - (a.lengthFt * a.widthFt * a.heightFt);
  });
  
  // Allocation logic (same as before but with sortedVehicles)
  for (const currentItem of remainingItems) {
    let remainingQty = currentItem.qty;
    
    // Try existing trucks first
    for (const alloc of allocations) {
      if (remainingQty <= 0) break;
      
      // Check if single unit fits
      const canSingleUnitFit = (pkg, truck) => {
        return (pkg.lengthFt <= truck.usableLengthFt && pkg.widthFt <= truck.usableWidthFt && pkg.heightFt <= truck.usableHeightFt) ||
               (pkg.widthFt <= truck.usableLengthFt && pkg.lengthFt <= truck.usableWidthFt && pkg.heightFt <= truck.usableHeightFt);
      };
      
      if (!canSingleUnitFit(currentItem, alloc.truckObj)) continue;
      
      // Check 3D fit
      const tempSpace = new Simple3DSpace(alloc.truckObj);
      tempSpace.placedBoxes = [...alloc.space3D.placedBoxes];
      tempSpace.totalCBM = alloc.space3D.totalCBM;
      tempSpace.totalWeight = alloc.space3D.totalWeight;
      tempSpace.itemsList = [...alloc.space3D.itemsList];
      
      const canFit = tempSpace.calculateMaxFit(currentItem, remainingQty);
      if (canFit > 0) {
        const toPlace = Math.min(canFit, remainingQty);
        let placed = 0;
        for (let i = 0; i < toPlace; i++) {
          const position = tempSpace.findBestPosition(currentItem);
          if (!position) break;
          if (tempSpace.totalCBM + currentItem.cbm > alloc.truckObj.cbmCapacity) break;
          if (tempSpace.totalWeight + currentItem.weightKg > alloc.truckObj.maxWeightKg) break;
          
          tempSpace.placeBox(currentItem, position.x, position.y, position.z,
                           position.length, position.width, position.height);
          placed++;
        }
        remainingQty -= placed;
        
        // Update allocation
        alloc.space3D = tempSpace;
        alloc.usedCBM = tempSpace.getUsedCBM();
        alloc.usedWeight = tempSpace.getUsedWeight();
        const existingItem = alloc.items.find(it => it.pkgId === currentItem.pkgId);
        if (existingItem) {
          existingItem.qty += placed;
        } else if (placed > 0) {
          alloc.items.push({ ...currentItem, qty: placed });
        }
      }
    }
    
    // Create new trucks for remaining
    while (remainingQty > 0) {
      let bestTruck = null;
      let bestCostEfficiency = 9999999;
      let maxFit = 0;
      
      for (const truck of sortedVehicles) {
        const canSingleUnitFit = (pkg, truck) => {
          return (pkg.lengthFt <= truck.usableLengthFt && pkg.widthFt <= truck.usableWidthFt && pkg.heightFt <= truck.usableHeightFt) ||
                 (pkg.widthFt <= truck.usableLengthFt && pkg.lengthFt <= truck.usableWidthFt && pkg.heightFt <= truck.usableHeightFt);
        };
        
        if (!canSingleUnitFit(currentItem, truck)) continue;
        
        const tempSpace = new Simple3DSpace(truck);
        const fit = tempSpace.calculateMaxFit(currentItem, remainingQty);
        
        if (fit > 0) {
          const truckRate = truckRatesMap[truck.truckId]?.rate || 999999;
          const costPerItem = truckRate / fit;
          
          if (costPerItem < bestCostEfficiency) {
            bestCostEfficiency = costPerItem;
            bestTruck = truck;
            maxFit = fit;
          }
        }
      }
      
      if (!bestTruck) break;
      
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
      let placed = 0;
      for (let i = 0; i < toPlace; i++) {
        const position = newAlloc.space3D.findBestPosition(currentItem);
        if (!position) break;
        if (newAlloc.space3D.totalCBM + currentItem.cbm > bestTruck.cbmCapacity) break;
        if (newAlloc.space3D.totalWeight + currentItem.weightKg > bestTruck.maxWeightKg) break;
        
        newAlloc.space3D.placeBox(currentItem, position.x, position.y, position.z,
                                 position.length, position.width, position.height);
        placed++;
      }
      
      newAlloc.usedCBM = newAlloc.space3D.getUsedCBM();
      newAlloc.usedWeight = newAlloc.space3D.getUsedWeight();
      newAlloc.items.push({ ...currentItem, qty: placed });
      
      allocations.push(newAlloc);
      remainingQty -= placed;
    }
    
    currentItem.qty = remainingQty;
  }
  
  // Calculate results
  const totalAllocated = allocations.reduce((total, alloc) => {
    return total + alloc.items.reduce((sum, item) => sum + (item.qty || 0), 0);
  }, 0);
  
  const totalRequired = items.reduce((total, item) => total + (item.qty || 0), 0);
  
  const totalCost = allocations.reduce((sum, alloc) => {
    return sum + (truckRatesMap[alloc.truckId]?.rate || 0);
  }, 0);
  
  return {
    strategyName,
    allocations,
    remainingItems: remainingItems.filter(item => item.qty > 0),
    totalAllocated,
    totalRequired,
    totalCost,
    successRate: (totalAllocated / totalRequired) * 100
  };
}

module.exports = { tryAllocationStrategy };