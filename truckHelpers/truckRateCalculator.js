const { sql } = require('../config/sqlConfig');

class TruckRateCalculator {
  constructor(client) {
    this.client = client;
  }


  async getCurrencyCode(currencyId) {
  try {
    const query = `
      SELECT TOP 1 CurrencyCode 
      FROM CurrencyMaster 
      WHERE CurrencyMasterId  = @currencyId
    `;
    
    const result = await this.client.request()
      .input('currencyId', sql.Int, currencyId)
      .query(query);
    
    if (result.recordset[0]) {
      return result.recordset[0].CurrencyCode || 'INR';
    }
  } catch (error) {
    console.error('Error fetching currency:', error);
  }
  return 'INR'; // Fallback
}
  // ========== PROCEDURE-LIKE RATE CALCULATION ==========

  // 1. Get vehicle column mapping
  async getVehicleColumnMapping(vehicleId) {
    const query = `
      SELECT TOP 1 ColumnName 
      FROM MapVehicle 
      WHERE VehicleId = @vehicleId
    `;
    
    const result = await this.client.request()
      .input('vehicleId', sql.Int, vehicleId)
      .query(query);
    
    return result.recordset[0]?.ColumnName || null;
  }

  // 2. Calculate FINAL rate for ONE truck (PROCEDURE LOGIC)
  async calculateFinalRateForTruck(vehicleId, fromLocationId, toLocationId, companyId, segmentId) {
    try {
     // console.log(`\n📊 Calculating rate for truck ${vehicleId}`);
      //console.log(`Route: ${fromLocationId} → ${toLocationId}`);
      
      // Step 1: Get column name
      const columnName = await this.getVehicleColumnMapping(vehicleId);
      if (!columnName) {
       // console.log(`❌ No column mapping for vehicle ${vehicleId}`);
        return null;
      }
      

      // Step 2: Get base rate (PROCEDURE LOGIC)
      const baseRateQuery = `
        SELECT TOP 1 
          ${columnName} as BaseRate,
          CurrencyId
        FROM TruckingContractsRate
        WHERE PickupLocationId = @fromLoc
          AND FinalLocationId = @toLoc
      `;
      

      const baseRateResult = await this.client.request()
        .input('fromLoc', sql.Int, fromLocationId)
        .input('toLoc', sql.Int, toLocationId)
        .query(baseRateQuery);
      
      const baseRateRow = baseRateResult.recordset[0];
      if (!baseRateRow || baseRateRow.BaseRate == null) {
       // console.log(`❌ No rate found for ${columnName} on this route`);
        return null;
      }
      
      const baseRate = Number(baseRateRow.BaseRate);
     let contractCurrencyId = baseRateRow.CurrencyId;

// Agar currency nahi mila, to default currency database se fetch karo
if (!contractCurrencyId) {
  const defaultCurrencyQuery = `
    SELECT TOP 1 CurrencyId 
    FROM CurrencyMaster 
    WHERE IsDefault = 1
  `;
  const defaultResult = await this.client.request().query(defaultCurrencyQuery);
  contractCurrencyId = defaultResult.recordset[0]?.CurrencyId || 1;
}

      // Step 3: Get appreciation % (PROCEDURE LOGIC)
      const appreciationQuery = `
        SELECT TOP 1 ISNULL(AppreciationPer, 0) as AppreciationPer
        FROM AppreciationConfiguration
        WHERE CompanyId = @companyId
          AND SegmentId = @segmentId
        ORDER BY AppreciationConfigurationId DESC
      `;
      
      const appreciationResult = await this.client.request()
        .input('companyId', sql.Int, companyId)
        .input('segmentId', sql.Int, segmentId)
        .query(appreciationQuery);
      
      const appreciationPercent = appreciationResult.recordset[0]?.AppreciationPer || 0;
     // console.log(`📈 Appreciation %: ${appreciationPercent}`);
      
      // Step 4: Apply appreciation (PROCEDURE LOGIC)
      const rateWithAppreciation = baseRate + (baseRate * appreciationPercent / 100.0);
     // console.log(`💰 After appreciation: ${rateWithAppreciation}`);
      
     // Step 5: Get exchange rate for USD conversion (if needed)
let exchangeRateToUSD = 1;

const defaultCurrencyId = 10; 

    // Only try exchange rate if currency is NOT default
    if (contractCurrencyId !== defaultCurrencyId) {
      try {
        const exchangeQuery = `
          SELECT TOP 1 ISNULL(ExchageRateCurrencyToUsd, 1) as ExchangeRate
          FROM ExchangeRatesDetails
          WHERE ExchangeRatesHdrId = (
            SELECT MAX(ExchangeRatesHdrId) FROM ExchangeRatesHdr
          )
          AND CurrencyId = @currencyId
        `;
        
        const exchangeResult = await this.client.request()
          .input('currencyId', sql.Int, contractCurrencyId)
          .query(exchangeQuery);
        
        if (exchangeResult.recordset[0]) {
          exchangeRateToUSD = exchangeResult.recordset[0].ExchangeRate;
        } else {
         // console.log(`⚠️ No exchange rate found for currency ${contractCurrencyId}, using 1.0`);
        }
      } catch (error) {
        //console.log(`⚠️ Exchange rate query failed: ${error.message}, using 1.0`);
      }
    } else {
      //console.log(`✅ Currency is default (${defaultCurrencyId}), exchange rate not needed`);
    }
      
      // Step 6: Calculate USD equivalent (for TotalTruckingChargesInUSD)
      const rateInUSD = rateWithAppreciation * exchangeRateToUSD;
      
      // Step 7: Get truck details
      const truckQuery = `
        SELECT 
          VehicleTypeMasterId as truckId,
          VehicleName as truckName,
          Length as lengthFt,
          Width as widthFt,
          Height as heightFt,
          ISNULL(CBMCapacity, 0) as cbmCapacity
        FROM VehicleTypeMaster
        WHERE VehicleTypeMasterId = @vehicleId
      `;
      
      const truckResult = await this.client.request()
        .input('vehicleId', sql.Int, vehicleId)
        .query(truckQuery);
      
      const truck = truckResult.recordset[0];
      
     return {
        truckId: vehicleId,
        truckName: truck?.truckName || `Truck ${vehicleId}`,
        
        // ✅ DYNAMIC CURRENCY FIELDS
        currencyId: contractCurrencyId,
        currencyCode: await this.getCurrencyCode(contractCurrencyId),
        
        // Dimensions
        lengthFt: Number(truck?.lengthFt || 0),
        widthFt: Number(truck?.widthFt || 0),
        heightFt: Number(truck?.heightFt || 0),
        cbmCapacity: Number(truck?.cbmCapacity || 0),
        
        // Usable dimensions
        usableLengthFt: Math.max(0, Number(truck?.lengthFt || 0) - 0.25),
        usableWidthFt: Math.max(0, Number(truck?.widthFt || 0) - 0.25),
        usableHeightFt: Math.max(0, Number(truck?.heightFt || 0) - 0.25),
        
        // Rates
        baseRate: baseRate,
        appreciationPercent: appreciationPercent,
        rateWithAppreciation: rateWithAppreciation,
        contractCurrencyId: contractCurrencyId,
        exchangeRateToUSD: exchangeRateToUSD,
        rateInUSD: rateInUSD,
        ratePerCbm: truck?.cbmCapacity > 0 ? rateWithAppreciation / truck.cbmCapacity : 0,
};
      
    } catch (error) {
      console.error(` Error calculating rate for truck ${vehicleId}:`, error);
      return null;
    }
  }

  // 3. Get rates for MULTIPLE trucks
  async getRatesForTrucks(truckIds, fromLocationId, toLocationId, companyId, segmentId) {
    const rates = [];
    
    for (const truckId of truckIds) {
      const rate = await this.calculateFinalRateForTruck(
        truckId, fromLocationId, toLocationId, companyId, segmentId
      );
      
      if (rate) {
        rates.push(rate);
      }
    }
    
    // Sort by rateWithAppreciation (cheapest first)
    rates.sort((a, b) => a.rateWithAppreciation - b.rateWithAppreciation);
    
   // console.log(`\n✅ FINAL RATES FOR ${rates.length} TRUCKS (Procedure Logic):`);
    rates.forEach((rate, i) => {
     // console.log(`${i+1}. ${rate.truckName}: ₹${rate.rateWithAppreciation.toFixed(2)} (₹${rate.ratePerCbm.toFixed(2)}/CBM)`);
    });
    
    return rates;
  }

  // 4. Get local charges separately (like procedure)
  async getLocalChargesSeparate(fromLocationId, toLocationId, segmentId) {
    const query = `
      -- Origin Charges
      SELECT 
        1 AS chargeForId,
        lcd.ChargeId,
        lcd.ChargeAmount,
        lcd.CurrencyId,
        lcd.UnitId,
        lcd.AtActual
      FROM LocalChargesDetails lcd
      INNER JOIN LocalCharges lc ON lcd.LocalChargesId = lc.LocalChargesId
      WHERE lcd.SegmentId = @segmentId 
        AND lc.CityId = @fromLoc
      
      UNION ALL
      
      -- Destination Charges  
      SELECT 
        2 AS chargeForId,
        lcd.ChargeId,
        lcd.ChargeAmount,
        lcd.CurrencyId,
        lcd.UnitId,
        lcd.AtActual
      FROM LocalChargesDetails lcd
      INNER JOIN LocalCharges lc ON lcd.LocalChargesId = lc.LocalChargesId
      WHERE lcd.SegmentId = @segmentId 
        AND lc.CityId = @toLoc
    `;
    
    const result = await this.client.request()
      .input('segmentId', sql.Int, segmentId)
      .input('fromLoc', sql.Int, fromLocationId)
      .input('toLoc', sql.Int, toLocationId)
      .query(query);
    
    return result.recordset;
  }
}

module.exports = TruckRateCalculator;