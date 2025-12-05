// truckHelpers/Simple3DSpace.js

// ✅ SIMPLE 3D Space Tracker - FIXED
class Simple3DSpace {
  constructor(truck) {
    this.truck = truck;
    this.placedBoxes = []; 
    this.totalCBM = 0;
    this.totalWeight = 0;
    this.itemsList = []; 
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
    }
  }

// ✅ EDGE POSITION CHECK (add after floor search, before stacking logic)
const edgeCheckRotations = [
  { length: pkg.lengthFt, width: pkg.widthFt },
  { length: pkg.widthFt, width: pkg.lengthFt }
];

for (const rot of edgeCheckRotations) {
  const maxX = this.truck.usableLengthFt - rot.length;
  const maxY = this.truck.usableWidthFt - rot.width;
  
  if (maxX >= 0 && maxY >= 0) {
    // 1. Check far corner
    if (this.canPlace(maxX, maxY, 0, rot.length, rot.width, pkg.heightFt)) {
      return { x: maxX, y: maxY, z: 0, ...rot, height: pkg.heightFt };
    }
    
    // 2. Check right edge (different Y positions)
    for (let y = 0; y <= maxY; y += 0.5) {
      if (this.canPlace(maxX, y, 0, rot.length, rot.width, pkg.heightFt)) {
        return { x: maxX, y: y, z: 0, ...rot, height: pkg.heightFt };
      }
    }
    
    // 3. Check top edge (different X positions)
    for (let x = 0; x <= maxX; x += 0.5) {
      if (this.canPlace(x, maxY, 0, rot.length, rot.width, pkg.heightFt)) {
        return { x: x, y: maxY, z: 0, ...rot, height: pkg.heightFt };
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
         const fitsTopBox = (rot.length <= topBox.length && rot.width <= topBox.width) ||
                   (rot.width <= topBox.length && rot.length <= topBox.width);
         if (fitsTopBox) {
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
        const fitsStackable = (rot.length <= stackable.length && rot.width <= stackable.width) ||
                      (rot.width <= stackable.length && rot.length <= stackable.width);
        if (fitsStackable) {
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
       const fitsOnStackable = (rot.length <= stackable.length && rot.width <= stackable.width) ||
                        (rot.width <= stackable.length && rot.length <= stackable.width);
           if (fitsOnStackable) {
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
// First try exact multiples (optimal packing)
for (let xMultiplier = 0; xMultiplier <= Math.floor(this.truck.usableLengthFt / rot.length); xMultiplier++) {
  for (let yMultiplier = 0; yMultiplier <= Math.floor(this.truck.usableWidthFt / rot.width); yMultiplier++) {
    const x = xMultiplier * rot.length;
    const y = yMultiplier * rot.width;
    if (this.canPlace(x, y, 0, rot.length, rot.width, pkg.heightFt)) {
      return { x, y, z: 0, ...rot, height: pkg.heightFt };
    }
  }
}

// Then try with stepSize for remaining gaps
for (let x = 0; x <= this.truck.usableLengthFt - rot.length; x += stepSize) {
  for (let y = 0; y <= this.truck.usableWidthFt - rot.width; y += stepSize) {
    // Skip positions already checked in exact multiples
    if (x % rot.length === 0 && y % rot.width === 0) continue;
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
    
    if (!pkg.stackable && tempSpace.placedBoxes.length > 0) {
  // Check if mixing with existing boxes is problematic
  let canMix = true;
  
  for (const box of tempSpace.placedBoxes) {
    if (box.pkg.stackable) continue; // Stackable ke saath mix OK
    
    // Non-stackable with non-stackable - check size compatibility
    const boxMaxDim = Math.max(box.length, box.width);
    const boxMinDim = Math.min(box.length, box.width);
    const pkgMaxDim = Math.max(pkg.lengthFt, pkg.widthFt);
    const pkgMinDim = Math.min(pkg.lengthFt, pkg.widthFt);
    
    // Don't mix very different sizes (more than 2x difference)
    if (pkgMaxDim > boxMaxDim * 2 || boxMaxDim > pkgMaxDim * 2) {
      canMix = false;
      break;
    }
  }
  
  if (!canMix) {
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
  static feet3ToCBM(lft, wft, hft) {
    return Number(((lft * wft * hft) * 0.028316846592).toFixed(6));
  }
}


module.exports = Simple3DSpace;
