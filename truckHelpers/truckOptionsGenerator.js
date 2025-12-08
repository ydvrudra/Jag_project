// truckHelpers/truckOptionsGenerator.js - COMPLETELY DYNAMIC
const Simple3DSpace = require('./Simple3DSpace');

class TruckOptionsGenerator {
  constructor(vehicles, truckRatesMap) {
    this.vehicles = vehicles;
    this.truckRatesMap = truckRatesMap;
  }

  // Main method to generate ALL possible options dynamically
  async generateOptions(items, currentAllocation) {
    const options = [];
    const totalPackages = items.reduce((sum, item) => sum + item.qty, 0);

    //console.log(`🔍 Generating dynamic options for ${totalPackages} packages`);
    //console.log(`Available trucks: ${this.vehicles.length}, With rates: ${Object.keys(this.truckRatesMap).length}`);

    // 1. SINGLE TRUCK TYPE OPTIONS (Most Economical)
    const singleTruckOptions = await this.generateSingleTruckOptions(items, totalPackages);
    options.push(...singleTruckOptions);

    // 2. MIXED TRUCK COMBINATIONS (Balanced)
    const mixedOptions = await this.generateMixedTruckOptions(items, totalPackages);
    options.push(...mixedOptions);

    // 3. CURRENT ALGORITHM RESULT (if exists and different)
    if (currentAllocation && currentAllocation.allocations) {
      const currentOption = this.createOptionFromAllocation(
        currentAllocation,
        "Algorithm Suggested",
        options.length + 1
      );
      
      // Only add if not duplicate of existing options
      if (!this.isDuplicateOption(options, currentOption)) {
        options.push(currentOption);
      }
    }

    // 4. TOP CAPACITY TRUCKS (For bulk items)
    const capacityOptions = await this.generateCapacityBasedOptions(items, totalPackages);
    options.push(...capacityOptions);

    // Final processing
    return this.finalizeOptions(options, totalPackages);
  }

  // ==================== DYNAMIC OPTION GENERATORS ====================

  // OPTION TYPE 1: Single truck type (cheapest possible)
  async generateSingleTruckOptions(items, totalPackages) {
    const options = [];
    
    // Sort trucks by rate (cheapest first)
    const trucksWithRates = this.vehicles
      .filter(truck => this.truckRatesMap[truck.truckId]?.rate)
      .sort((a, b) => {
        const rateA = this.truckRatesMap[a.truckId].rate;
        const rateB = this.truckRatesMap[b.truckId].rate;
        return rateA - rateB;
      });

    // Try top 5 cheapest trucks
    for (const truck of trucksWithRates.slice(0, 5)) {
      const truckRate = this.truckRatesMap[truck.truckId].rate;
      const currency = this.truckRatesMap[truck.truckId].currency || 'INR';
      
      // Calculate max packages per truck
      const maxPerTruck = await this.calculateMaxPackagesPerTruck(truck, items);
      if (maxPerTruck === 0) continue;

      // Calculate trucks needed
      const trucksNeeded = Math.ceil(totalPackages / maxPerTruck);
      
      // Skip if too many trucks (more than 5)
      if (trucksNeeded > 5) continue;

      // Verify all packages actually fit
      const canFit = await this.verifyAllPackagesFit(items, truck, trucksNeeded, maxPerTruck);
      if (!canFit) continue;

      // Create dynamic option name
      const optionName = this.generateSingleTruckOptionName(truck, trucksNeeded);
      
      // Create allocations
      const allocations = [];
      let remainingPackages = totalPackages;
      
      for (let i = 0; i < trucksNeeded; i++) {
        const packagesThisTruck = Math.min(remainingPackages, maxPerTruck);
        allocations.push({
          truckId: truck.truckId,
          truckName: truck.truckName,
          truckCount: 1,
          qtyItems: packagesThisTruck,
          usedCBM: this.estimateUsedCBM(truck, packagesThisTruck, items),
          usedWeightKg: this.estimateUsedWeight(items, packagesThisTruck),
          ratePerTruck: truckRate,
          currency: currency,
          totalForThisTruck: truckRate
        });
        remainingPackages -= packagesThisTruck;
      }

      options.push({
        optionName: `${optionName} - Most Economical`,
        allocations,
        totalCost: truckRate * trucksNeeded,
        currency,
        totalTrucks: trucksNeeded,
        totalPackages
      });
    }

    return options.slice(0, 3); // Return top 3
  }

  // OPTION TYPE 2: Mixed truck combinations
  async generateMixedTruckOptions(items, totalPackages) {
    const options = [];
    
    // Get trucks sorted by value (rate per CBM)
    const trucksByValue = this.vehicles
      .filter(truck => this.truckRatesMap[truck.truckId]?.rate && truck.cbmCapacity > 0)
      .map(truck => ({
        ...truck,
        rate: this.truckRatesMap[truck.truckId].rate,
        currency: this.truckRatesMap[truck.truckId].currency || 'INR',
        value: this.truckRatesMap[truck.truckId].rate / truck.cbmCapacity
      }))
      .sort((a, b) => a.value - b.value); // Best value first

    // Try different combinations (2-3 trucks max)
    const combinations = [
      [trucksByValue[0], trucksByValue[1]], // Best 2 value trucks
      [trucksByValue[0], trucksByValue[2]], // Best + 3rd best
      trucksByValue.slice(0, 3) // Top 3 value trucks
    ];

    for (const truckList of combinations) {
      if (!truckList || truckList.length < 2 || truckList.some(t => !t)) continue;

      // Try to allocate packages
      const allocationPlan = await this.createAllocationPlan(items, truckList);
      if (!allocationPlan || allocationPlan.totalPackages !== totalPackages) continue;

      // Create option
      const optionName = this.generateMixedTruckOptionName(allocationPlan.allocations);
      const currency = allocationPlan.allocations[0]?.currency || 'INR';
      
      options.push({
        optionName: `${optionName} - Balanced`,
        allocations: allocationPlan.allocations,
        totalCost: allocationPlan.totalCost,
        currency,
        totalTrucks: allocationPlan.allocations.length,
        totalPackages
      });

      // Limit to 2 mixed options
      if (options.length >= 2) break;
    }

    return options;
  }

  // OPTION TYPE 3: Capacity-based options (for bulky items)
  async generateCapacityBasedOptions(items, totalPackages) {
    const options = [];
    
    // Sort trucks by capacity (largest first)
    const trucksByCapacity = [...this.vehicles]
      .filter(truck => truck.cbmCapacity > 0)
      .sort((a, b) => b.cbmCapacity - a.cbmCapacity);

    // Try largest trucks first
    for (const truck of trucksByCapacity.slice(0, 3)) {
      const truckRate = this.truckRatesMap[truck.truckId]?.rate;
      if (!truckRate) continue;

      const currency = this.truckRatesMap[truck.truckId]?.currency || 'INR';
      
      // Check if this truck can handle bulky items
      const canHandleBulky = await this.canHandleBulkyItems(truck, items);
      if (!canHandleBulky) continue;

      const maxPerTruck = await this.calculateMaxPackagesPerTruck(truck, items);
      if (maxPerTruck === 0) continue;

      const trucksNeeded = Math.ceil(totalPackages / maxPerTruck);
      
      // Create option
      const optionName = trucksNeeded === 1 
        ? `${truck.truckName} (High Capacity)`
        : `${trucksNeeded} × ${truck.truckName} (High Capacity)`;

      // Create allocations
      const allocations = [];
      let remainingPackages = totalPackages;
      
      for (let i = 0; i < trucksNeeded; i++) {
        const packagesThisTruck = Math.min(remainingPackages, maxPerTruck);
        allocations.push({
          truckId: truck.truckId,
          truckName: truck.truckName,
          truckCount: 1,
          qtyItems: packagesThisTruck,
          usedCBM: this.estimateUsedCBM(truck, packagesThisTruck, items),
          usedWeightKg: this.estimateUsedWeight(items, packagesThisTruck),
          ratePerTruck: truckRate,
          currency: currency,
          totalForThisTruck: truckRate
        });
        remainingPackages -= packagesThisTruck;
      }

      options.push({
        optionName,
        allocations,
        totalCost: truckRate * trucksNeeded,
        currency,
        totalTrucks: trucksNeeded,
        totalPackages
      });

      if (options.length >= 2) break;
    }

    return options;
  }

  // ==================== HELPER METHODS ====================

  // Create option from current algorithm result
  createOptionFromAllocation(allocation, suffix, optionId) {
    const optionName = this.generateAllocationBasedOptionName(allocation.allocations, suffix);
    
    return {
      optionId,
      optionName,
      allocations: allocation.allocations.map(alloc => ({
        ...alloc,
        // Ensure all fields are present
        truckCount: alloc.truckCount || 1,
        qtyItems: alloc.qtyItems || 0,
        usedCBM: alloc.usedCBM || 0,
        usedWeightKg: alloc.usedWeightKg || 0,
        ratePerTruck: alloc.ratePerTruck || 0,
        currency: alloc.currency || allocation.currency || 'INR',
        totalForThisTruck: (alloc.ratePerTruck || 0) * (alloc.truckCount || 1)
      })),
      totalCost: allocation.totalCost || 0,
      currency: allocation.currency || 'INR',
      totalTrucks: allocation.allocations.reduce((sum, alloc) => sum + (alloc.truckCount || 1), 0),
      totalPackages: allocation.allocations.reduce((sum, alloc) => sum + (alloc.qtyItems || 0), 0)
    };
  }

  // Check if option is duplicate
  isDuplicateOption(existingOptions, newOption) {
    return existingOptions.some(existing => 
      Math.abs(existing.totalCost - newOption.totalCost) < 0.01 &&
      existing.totalTrucks === newOption.totalTrucks &&
      existing.allocations.length === newOption.allocations.length
    );
  }

  // Final processing of options
  finalizeOptions(options, totalPackages) {
    if (options.length === 0) return [];

    // Sort by total cost (cheapest first)
    options.sort((a, b) => a.totalCost - b.totalCost);

    // Remove duplicates (keep cheapest)
    const uniqueOptions = [];
    const seen = new Set();
    
    for (const option of options) {
      const key = `${option.totalCost.toFixed(2)}-${option.totalTrucks}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueOptions.push(option);
      }
    }

    uniqueOptions.forEach(opt => {
    // ✅ FIX 2: Dynamic currency symbol
    const currencySymbol = this.getCurrencySymbol(opt.currency);
   // console.log(`   Option ${opt.optionId}: ${opt.optionName} - ${currencySymbol}${opt.totalCost} (${opt.totalTrucks} trucks)`);
  });

  return uniqueOptions; 
  }

  // ✅ NEW METHOD: Get currency symbol dynamically
getCurrencySymbol(currencyCode) {
  const symbols = {
    'USD': '$',
    'INR': '₹',
    'EUR': '€',
    'GBP': '£'
  };
  return symbols[currencyCode] || currencyCode;
}

  // ==================== NAME GENERATORS ====================

  generateSingleTruckOptionName(truck, count) {
    return count === 1 
      ? `${truck.truckName}`
      : `${count} × ${truck.truckName}`;
  }

  generateMixedTruckOptionName(allocations) {
    const truckCounts = {};
    
    allocations.forEach(alloc => {
      const name = alloc.truckName;
      truckCounts[name] = (truckCounts[name] || 0) + (alloc.truckCount || 1);
    });

    const parts = Object.entries(truckCounts).map(([name, count]) => 
      count === 1 ? name : `${count} × ${name}`
    );

    return parts.join(' + ');
  }

  generateAllocationBasedOptionName(allocations, suffix) {
    if (!allocations || allocations.length === 0) {
      return `Custom Option - ${suffix}`;
    }

    const truckCounts = {};
    allocations.forEach(alloc => {
      const name = alloc.truckName || `Truck-${alloc.truckId}`;
      truckCounts[name] = (truckCounts[name] || 0) + (alloc.truckCount || 1);
    });

    const parts = Object.entries(truckCounts).map(([name, count]) => 
      count === 1 ? name : `${count} × ${name}`
    );

    return `${parts.join(' + ')} - ${suffix}`;
  }

  // ==================== PACKING CALCULATIONS ====================

  async calculateMaxPackagesPerTruck(truck, items) {
    try {
      const space = new Simple3DSpace(truck);
      let totalCapacity = 0;
      
      for (const item of items) {
        const maxFit = space.calculateMaxFit(item, item.qty);
        if (maxFit > 0) {
          totalCapacity += maxFit;
          // Try to place them to update space
          for (let i = 0; i < maxFit; i++) {
            const position = space.findBestPosition(item);
            if (position) {
              space.placeBox(item, position.x, position.y, position.z,
                           position.length, position.width, position.height);
            }
          }
        }
      }
      
      return totalCapacity;
    } catch (error) {
      console.error(`Error calculating capacity for ${truck.truckName}:`, error);
      return 0;
    }
  }

  async verifyAllPackagesFit(items, truck, truckCount, maxPerTruck) {
    try {
      // Simulate packing for all trucks
      let remainingItems = items.map(item => ({ ...item }));
      
      for (let t = 0; t < truckCount; t++) {
        const space = new Simple3DSpace(truck);
        let placedInThisTruck = 0;
        
        for (let i = 0; i < remainingItems.length; i++) {
          if (placedInThisTruck >= maxPerTruck) break;
          
          const item = remainingItems[i];
          if (!item || item.qty <= 0) continue;
          
          const maxFit = space.calculateMaxFit(item, Math.min(item.qty, maxPerTruck - placedInThisTruck));
          if (maxFit > 0) {
            placedInThisTruck += maxFit;
            remainingItems[i].qty -= maxFit;
          }
        }
      }
      
      const totalRemaining = remainingItems.reduce((sum, item) => sum + item.qty, 0);
      return totalRemaining === 0;
    } catch (error) {
      console.error(`Error verifying fit for ${truck.truckName}:`, error);
      return false;
    }
  }

  async createAllocationPlan(items, trucks) {
    const allocations = [];
    let totalCost = 0;
    let remainingItems = items.map(item => ({ ...item }));
    let totalAllocated = 0;
    
    for (const truck of trucks) {
      const truckRate = this.truckRatesMap[truck.truckId]?.rate;
      if (!truckRate) continue;

      const space = new Simple3DSpace(truck);
      let placedInThisTruck = 0;
      
      for (let i = 0; i < remainingItems.length; i++) {
        const item = remainingItems[i];
        if (!item || item.qty <= 0) continue;
        
        const maxFit = space.calculateMaxFit(item, item.qty);
        if (maxFit > 0) {
          placedInThisTruck += maxFit;
          remainingItems[i].qty -= maxFit;
          totalAllocated += maxFit;
        }
      }
      
      if (placedInThisTruck > 0) {
        allocations.push({
          truckId: truck.truckId,
          truckName: truck.truckName,
          truckCount: 1,
          qtyItems: placedInThisTruck,
          usedCBM: this.estimateUsedCBM(truck, placedInThisTruck, items),
          usedWeightKg: this.estimateUsedWeight(items, placedInThisTruck),
          ratePerTruck: truckRate,
          currency: this.truckRatesMap[truck.truckId]?.currency || 'INR',
          totalForThisTruck: truckRate
        });
        
        totalCost += truckRate;
      }
    }
    
    const totalRequired = items.reduce((sum, item) => sum + item.qty, 0);
    
    if (totalAllocated === totalRequired) {
      return {
        allocations,
        totalCost,
        totalPackages: totalAllocated
      };
    }
    
    return null;
  }

  async canHandleBulkyItems(truck, items) {
    // Check if truck can handle the largest item
    const maxItemLength = Math.max(...items.map(item => item.lengthFt));
    const maxItemWidth = Math.max(...items.map(item => item.widthFt));
    
    return maxItemLength <= truck.usableLengthFt && 
           maxItemWidth <= truck.usableWidthFt;
  }

  // ==================== ESTIMATION METHODS ====================

  estimateUsedCBM(truck, packagesCount, items) {
    // More accurate estimation based on average item CBM
    const avgItemCBM = items.reduce((sum, item) => sum + item.cbm, 0) / items.length;
    return avgItemCBM * packagesCount;
  }

  estimateUsedWeight(items, packagesCount) {
    const avgWeight = items.reduce((sum, item) => sum + item.weightKg, 0) / items.length;
    return avgWeight * packagesCount;
  }
}

module.exports = TruckOptionsGenerator;