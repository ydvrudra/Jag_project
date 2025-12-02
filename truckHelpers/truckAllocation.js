//truckHelpers/truckAllocation.js
const { sql } = require('../config/sqlConfig');
const { processFinalAllocations } = require('./truckAllocationHelpers');

function feet3ToCBM(lft, wft, hft) {
  return Number(((lft * wft * hft) * 0.028316846592).toFixed(6));
}

// ✅ SIMPLE 3D Space Tracker - FIXED
class Simple3DSpace {
  constructor(truck) {
    this.truck = truck;
    this.placedBoxes = []; // Track positions
    this.totalCBM = 0;
    this.totalWeight = 0;
    this.itemsList = []; // For quantity tracking
  }

  // Check if position is free
  canPlace(x, y, z, length, width, height) {
    // Check truck boundaries
    if (x + length > this.truck.usableLengthFt) return false;
    if (y + width > this.truck.usableWidthFt) return false;
    if (z + height > this.truck.usableHeightFt) return false;

    // Check overlap with existing boxes
    for (const box of this.placedBoxes) {
      if (this.boxesOverlap(x, y, z, length, width, height,
                           box.x, box.y, box.z, box.length, box.width, box.height)) {
        return false;
      }
    }
    
    return true;
  }

  // Check if two boxes overlap
  boxesOverlap(x1, y1, z1, l1, w1, h1, x2, y2, z2, l2, w2, h2) {
    return !(x1 + l1 <= x2 || x2 + l2 <= x1 ||
             y1 + w1 <= y2 || y2 + w2 <= y1 ||
             z1 + h1 <= z2 || z2 + h2 <= z1);
  }

  // Place a box at position
  placeBox(pkg, x, y, z, length, width, height) {
    this.placedBoxes.push({
      pkg,
      x, y, z,
      length, width, height
    });
    
    // ✅ CORRECT: Add package CBM (pre-calculated)
    this.totalCBM += pkg.cbm;
    this.totalWeight += pkg.weightKg;
    
    // Track quantity
    const existing = this.itemsList.find(it => it.pkgId === pkg.pkgId);
    if (existing) {
      existing.qty += 1;
    } else {
      this.itemsList.push({ ...pkg, qty: 1 });
    }
    
    return true;
  }

  findBestPosition(pkg) {
  const rotations = [
    { length: pkg.lengthFt, width: pkg.widthFt },
    { length: pkg.widthFt, width: pkg.lengthFt }
  ];

  // ✅ IMPROVEMENT 1: Try MORE AGGRESSIVE floor positions (better grid search)
  // First try with 1ft step (faster), then 0.5ft (more precise)
  const stepSizes = [1, 0.5];
  
  for (const stepSize of stepSizes) {
    for (const rot of rotations) {
      // Try length-wise arrangement first (optimize for long packages)
      for (let x = 0; x <= this.truck.usableLengthFt - rot.length; x += stepSize) {
        for (let y = 0; y <= this.truck.usableWidthFt - rot.width; y += stepSize) {
          if (this.canPlace(x, y, 0, rot.length, rot.width, pkg.heightFt)) {
            return { x, y, z: 0, ...rot, height: pkg.heightFt };
          }
        }
      }
      
      // Also try width-wise arrangement (for better space utilization)
      if (rot.length !== rot.width) { // Skip if square
        const swappedRot = { length: rot.width, width: rot.length };
        for (let x = 0; x <= this.truck.usableLengthFt - swappedRot.length; x += stepSize) {
          for (let y = 0; y <= this.truck.usableWidthFt - swappedRot.width; y += stepSize) {
            if (this.canPlace(x, y, 0, swappedRot.length, swappedRot.width, pkg.heightFt)) {
              return { x, y, z: 0, ...swappedRot, height: pkg.heightFt };
            }
          }
        }
      }
    }
  }

  // ✅ IMPROVEMENT 2: Better stacking logic for STACKABLE items
  if (pkg.stackable) {
    const stackables = this.placedBoxes.filter(b => b.pkg.stackable);
    
    // Strategy 1: Try stacking in existing columns (maximize height utilization)
    const columns = {};
    for (const box of stackables) {
      const key = `${box.x},${box.y}`;
      if (!columns[key]) columns[key] = [];
      columns[key].push(box);
    }
    
    // Sort columns by current height (lower height first for better balance)
    const sortedColumns = Object.entries(columns).sort(([, colA], [, colB]) => {
      const heightA = colA.reduce((max, box) => Math.max(max, box.z + box.height), 0);
      const heightB = colB.reduce((max, box) => Math.max(max, box.z + box.height), 0);
      return heightA - heightB;
    });
    
    for (const [key, columnBoxes] of sortedColumns) {
      const [baseX, baseY] = key.split(',').map(Number);
      
      // Find top of this column
      const topBox = columnBoxes.reduce((max, box) => 
        (box.z + box.height > max.z + max.height) ? box : max, 
        columnBoxes[0]
      );
      
      const topZ = topBox.z + topBox.height;
      
      // Check height limit with some buffer
      const maxLayers = Math.floor(this.truck.usableHeightFt / pkg.heightFt);
      const currentLayers = columnBoxes.length;
      
      if (currentLayers < maxLayers) {
        for (const rot of rotations) {
          if (rot.length <= topBox.length && rot.width <= topBox.width) {
            if (this.canPlace(baseX, baseY, topZ, rot.length, rot.width, pkg.heightFt)) {
              return { x: baseX, y: baseY, z: topZ, ...rot, height: pkg.heightFt };
            }
          }
        }
      }
    }
    
    // Strategy 2: Try on top of ANY stackable box (for mixed sizes)
    // Sort stackables by available space on top (larger area first)
    const sortedStackables = [...stackables].sort((a, b) => {
      const areaA = a.length * a.width;
      const areaB = b.length * b.width;
      return areaB - areaA; // Larger area first
    });
    
    for (const stackable of sortedStackables) {
      const topZ = stackable.z + stackable.height;
      
      if (topZ + pkg.heightFt > this.truck.usableHeightFt) continue;
      
      for (const rot of rotations) {
        if (rot.length <= stackable.length && rot.width <= stackable.width) {
          if (this.canPlace(stackable.x, stackable.y, topZ, 
                           rot.length, rot.width, pkg.heightFt)) {
            return { 
              x: stackable.x, 
              y: stackable.y, 
              z: topZ, 
              ...rot, 
              height: pkg.heightFt 
            };
          }
        }
      }
    }
    
    // Strategy 3: Try filling gaps between stackables (lateral arrangement)
    for (const stackable of stackables) {
      for (const rot of rotations) {
        // Try right side with gap filling logic
        const rightX = stackable.x + stackable.length;
        if (rightX + rot.length <= this.truck.usableLengthFt) {
          // Check if there's empty space to the right
          let hasObstruction = false;
          for (const box of this.placedBoxes) {
            if (box !== stackable && 
                box.x >= rightX && 
                box.x < rightX + rot.length &&
                box.y >= stackable.y && 
                box.y < stackable.y + rot.width) {
              hasObstruction = true;
              break;
            }
          }
          
          if (!hasObstruction && this.canPlace(rightX, stackable.y, stackable.z, 
                                              rot.length, rot.width, pkg.heightFt)) {
            return { 
              x: rightX, 
              y: stackable.y, 
              z: stackable.z, 
              ...rot, 
              height: pkg.heightFt 
            };
          }
        }
        
        // Try front side with gap filling
        const frontY = stackable.y + stackable.width;
        if (frontY + rot.width <= this.truck.usableWidthFt) {
          if (this.canPlace(stackable.x, frontY, stackable.z, 
                           rot.length, rot.width, pkg.heightFt)) {
            return { 
              x: stackable.x, 
              y: frontY, 
              z: stackable.z, 
              ...rot, 
              height: pkg.heightFt 
            };
          }
        }
      }
    }
  }

  // ✅ IMPROVEMENT 3: Enhanced logic for NON-STACKABLE items
  if (!pkg.stackable) {
    const stackables = this.placedBoxes.filter(b => b.pkg.stackable);
    
    // Priority 1: On top of stackables (exact fit)
    for (const stackable of stackables) {
      const topZ = stackable.z + stackable.height;
      
      if (topZ + pkg.heightFt > this.truck.usableHeightFt) continue;
      
      for (const rot of rotations) {
        if (rot.length <= stackable.length && rot.width <= stackable.width) {
          if (this.canPlace(stackable.x, stackable.y, topZ, 
                           rot.length, rot.width, pkg.heightFt)) {
            return { 
              x: stackable.x, 
              y: stackable.y, 
              z: topZ, 
              ...rot, 
              height: pkg.heightFt 
            };
          }
        }
      }
    }
    
    // Priority 2: Next to stackables (same level) - with better gap detection
    const placedPositions = this.placedBoxes.map(b => ({ 
      x: b.x, y: b.y, length: b.length, width: b.width, z: b.z 
    }));
    
    // Sort by position to find gaps systematically
    placedPositions.sort((a, b) => {
      if (a.x !== b.x) return a.x - b.x;
      return a.y - b.y;
    });
    
    // Try to fill gaps in X direction
    for (let i = 0; i < placedPositions.length; i++) {
      const box = placedPositions[i];
      for (const rot of rotations) {
        // Try right side
        const rightX = box.x + box.length;
        if (rightX + rot.length <= this.truck.usableLengthFt) {
          // Check if this space is empty
          let canFit = true;
          for (const otherBox of this.placedBoxes) {
            if (this.boxesOverlap(rightX, box.y, box.z, 
                                 rot.length, rot.width, pkg.heightFt,
                                 otherBox.x, otherBox.y, otherBox.z,
                                 otherBox.length, otherBox.width, otherBox.height)) {
              canFit = false;
              break;
            }
          }
          
          if (canFit && this.canPlace(rightX, box.y, box.z, 
                                     rot.length, rot.width, pkg.heightFt)) {
            return { 
              x: rightX, 
              y: box.y, 
              z: box.z, 
              ...rot, 
              height: pkg.heightFt 
            };
          }
        }
        
        // Try below (in Y direction)
        const belowY = box.y + box.width;
        if (belowY + rot.width <= this.truck.usableWidthFt) {
          if (this.canPlace(box.x, belowY, box.z, 
                           rot.length, rot.width, pkg.heightFt)) {
            return { 
              x: box.x, 
              y: belowY, 
              z: box.z, 
              ...rot, 
              height: pkg.heightFt 
            };
          }
        }
      }
    }
    
    // Priority 3: Any empty floor space (re-check with optimized search)
    for (const rot of rotations) {
      for (let x = 0; x <= this.truck.usableLengthFt - rot.length; x += 1) {
        for (let y = 0; y <= this.truck.usableWidthFt - rot.width; y += 1) {
          if (this.canPlace(x, y, 0, rot.length, rot.width, pkg.heightFt)) {
            return { x, y, z: 0, ...rot, height: pkg.heightFt };
          }
        }
      }
    }
  }

  // ✅ IMPROVEMENT 4: Final attempt - try different Z levels for stacking
  // This helps when floor is full but vertical space available
  if (pkg.stackable) {
    // Try to create new columns near existing ones
    const existingColumns = new Set();
    for (const box of this.placedBoxes) {
      existingColumns.add(`${Math.floor(box.x)},${Math.floor(box.y)}`);
    }
    
    // Try creating new columns near existing ones
    for (const column of existingColumns) {
      const [colX, colY] = column.split(',').map(Number);
      
      // Try positions around this column
      const offsets = [-2, -1, 1, 2];
      for (const dx of offsets) {
        for (const dy of offsets) {
          const testX = colX + dx;
          const testY = colY + dy;
          
          if (testX >= 0 && testY >= 0) {
            for (const rot of rotations) {
              if (testX + rot.length <= this.truck.usableLengthFt &&
                  testY + rot.width <= this.truck.usableWidthFt) {
                if (this.canPlace(testX, testY, 0, rot.length, rot.width, pkg.heightFt)) {
                  return { x: testX, y: testY, z: 0, ...rot, height: pkg.heightFt };
                }
              }
            }
          }
        }
      }
    }
  }

  return null;
}

  calculateMaxFit(pkg, maxQty) {
  const tempSpace = new Simple3DSpace(this.truck);
  tempSpace.placedBoxes = [...this.placedBoxes];
  tempSpace.totalCBM = this.totalCBM;
  tempSpace.totalWeight = this.totalWeight;
  tempSpace.itemsList = [...this.itemsList];
  
  let fitted = 0;
  
  for (let i = 0; i < maxQty; i++) {
    const position = tempSpace.findBestPosition(pkg);
    if (!position) break;
    
    // Check CBM constraint
    if (tempSpace.totalCBM + pkg.cbm > this.truck.cbmCapacity) break;
    
    // Check weight constraint
    if (tempSpace.totalWeight + pkg.weightKg > this.truck.maxWeightKg) break;
    
    // ✅ FIX: Only check size mixing for NON-STACKABLE
    if (!pkg.stackable && tempSpace.placedBoxes.length > 0) {
      const firstBox = tempSpace.placedBoxes[0];
      const firstLength = Math.max(firstBox.length, firstBox.width);
      const pkgLength = Math.max(pkg.lengthFt, pkg.widthFt);
      
      // Don't mix very different sizes for non-stackable
      if (Math.abs(firstLength - pkgLength) > Math.min(firstLength, pkgLength) * 2) {
        console.log(`   ⚠️ Won't mix non-stackable ${firstLength}ft with ${pkgLength}ft`);
        break;
      }
    }
    
    // Place the box
    tempSpace.placeBox(pkg, position.x, position.y, position.z,
                      position.length, position.width, position.height);
    fitted++;
  }
  
  return fitted;
}

  getItems() {
    return this.itemsList;
  }

  getUsedCBM() {
    return this.totalCBM;
  }

  getUsedWeight() {
    return this.totalWeight;
  }
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
      : (copy.usableLengthFt && copy.usableWidthFt && copy.usableHeightFt ? feet3ToCBM(copy.usableLengthFt, copy.usableWidthFt, copy.usableHeightFt) : 0);
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

  if (oversizedPackages.length > 0 || overweightPackages.length > 0) {
    console.log("\n⚠️  PACKAGE VALIDATION WARNINGS:");
    if (oversizedPackages.length > 0) {
      oversizedPackages.forEach(p => console.log(`   ${p.pkgId}: ${p.dimensions} - ${p.issue}`));
    }
    if (overweightPackages.length > 0) {
      overweightPackages.forEach(p => console.log(`   ${p.pkgId}: ${p.weight} > max ${p.maxWeight}`));
    }
    console.log(`\n✅ Continuing with ${validPackages.length} valid packages`);
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

  console.log("\n✅ All valid packages are within truck capacity limits");

  // Prepare items
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

  console.log("\n🚛 STARTING 3D ALLOCATION...");

  let remainingItems = items.map(it => ({ ...it }));
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
    
    const { totalTruckingChargesInUSD, allocationsStatus } = await processFinalAllocations({
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

  // Success case
  console.log("\n" + "=".repeat(50));
  console.log("🎯 ALLOCATION SUCCESS");
  console.log("=".repeat(50));

  validAllocations.forEach(alloc => {
    console.log(`\n🚛 ${alloc.truckName}:`);
    console.log(`   📦 ${alloc.items.map(it => `${it.pkgId}×${it.qty}`).join(', ')}`);
    console.log(`   📊 ${alloc.usedCBM.toFixed(3)}CBM / ${alloc.truckObj.cbmCapacity}CBM (${((alloc.usedCBM / alloc.truckObj.cbmCapacity) * 100).toFixed(1)}%)`);
    console.log(`   ⚖️  ${alloc.usedWeight.toFixed(1)}kg / ${alloc.truckObj.maxWeightKg}kg (${((alloc.usedWeight / alloc.truckObj.maxWeightKg) * 100).toFixed(1)}%)`);
  });

  const { totalTruckingChargesInUSD, allocationsStatus } = await processFinalAllocations({
    allocationsInstances: validAllocations,
    remainingPkgs: [],
    client,
    vehicles
  });

  if (allocationsStatus) {
    return allocationsStatus;
  }

  return {
    status: "success",
    message: `All packages allocated in ${validAllocations.length} trucks`,
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
    totalTruckingChargesInUSD: totalTruckingChargesInUSD || 0
  };
}

module.exports = { allocateTrucksAndPrice };