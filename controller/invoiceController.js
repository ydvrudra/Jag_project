//controller/invoiceController

const axios = require('axios');
const { pool, poolConnect, sql } = require('../config/sqlConfig');
const fs = require("fs");
const { extractedExcelFile } = require("../config/constants");
const { scrapePdfLinks } = require("../services/scraperService");
const { processInvoice } = require("../services/invoiceProcessor");
const { sendInvoiceProcessingSummaryEmail } = require("../services/emailService");


exports.processAllInvoices = async (req, res) => {
  try {
    const pdfLinks = await scrapePdfLinks();

    if (pdfLinks.length === 0) {
      return res.json({ message: "No PDF files found to process." });
    }

    const results = [];
    const errors = [];
     const successFiles = []; 
    const failFiles = [];   

    for (const { fullUrl, fileName, localPath } of pdfLinks) {
      try {
        await processInvoice(fullUrl, fileName, localPath);
        results.push({ fileName, status: "success" });
        successFiles.push(fileName); 
      } catch (err) {
        console.error(` Failed: ${fileName}`, err.message);
        errors.push({ fileName, error: err.message });
        failFiles.push(fileName); 
      }
    }

    res.json({
      status: "done",
      processed: results.length,
      failed: errors.length,
      details: { success: results, errors },
    });

    const excelPath = extractedExcelFile;
   const userEmail = req.headers["email"] || process.env.DEFAULT_EMAIL;

    try {
  await sendInvoiceProcessingSummaryEmail({
    successCount: results.length,
    failCount: errors.length,
    successFiles: successFiles, 
    failFiles: failFiles,
    attachmentPath: excelPath,
    toEmail: userEmail,
  });
  console.log("📧 Summary email sent");
} catch (emailErr) {
  console.error("❌ Email send failed:", emailErr.message);
}



  } catch (err) {
    console.error(" Error processing invoices:", err.message);
    res.status(500).json({ error: "Processing failed", details: err.message });
  }
};

exports.downloadExcelFile = (req, res) => {
  if (!fs.existsSync(extractedExcelFile)) {
    return res.status(404).json({ error: "Excel file not found." });
  }

  res.download(extractedExcelFile, "Invoices.xlsx", (err) => {
    if (err) {
      console.error(" Excel download error:", err.message);
      res.status(500).json({ error: "Download failed." });
    }
  });
};




exports.fetchExchangeRates = async (req, res) => {
  try {
    await poolConnect;

    const limit = parseInt(req.query.limit) || 999;
    const response = await axios.get("https://api.exchangerate-api.com/v4/latest/USD");
    const { base, rates } = response.data;

    const limitedRates = Object.entries(rates).slice(0, limit);

    for (let [toCurrency, rate] of limitedRates) {
      // // USD to Other
      // await pool.request()
      //   .input('FromCurrency', sql.VarChar(3), base)
      //   .input('ToCurrency', sql.VarChar(3), toCurrency)
      //   .input('Rate', sql.Float, rate)
      //   .query(`
      //     INSERT INTO ExchangeRates (FromCurrency, ToCurrency, Rate, UpdatedAt)
      //     VALUES (@FromCurrency, @ToCurrency, @Rate, GETDATE())
      //   `);

      // Other to USD
      if (rate !== 0) {
        await pool.request()
          .input('FromCurrency', sql.VarChar(3), toCurrency)
          .input('ToCurrency', sql.VarChar(3), base)
          .input('Rate', sql.Float, 1 / rate)
          .query(`
            INSERT INTO ExchangeRates (FromCurrency, ToCurrency, Rate, UpdatedAt)
            VALUES (@FromCurrency, @ToCurrency, @Rate, GETDATE())
          `);
      }
    }

    res.status(200).json({ message: `${limit} exchange rates inserted successfully.` });
  } catch (error) {
    console.error("Error:", error.message);
    res.status(500).json({ message: 'Error fetching exchange rates', error: error.message });
  }
};

// controllers/truckController.js
// const { pool, poolConnect, sql } = require('../config/sqlConfig');

// async function suggestTruckForEnquiry(req, res) {
//   await poolConnect;
//   const client = pool;
//   const { recordId, packages: bodyPackages = [], userId = 0, persist = false } = req.body || {};

//   try {
//     // --- 1) load header and packages (or from body) ---
//     let hdr = { CalculationUnitId: 3, FromPinCodeId: 0, ToLocationRouteId: 0, CompanyId: 0, SegmentId: 0, LocationId: 0 };
//     let pkgRows = [];

//     if (recordId) {
//       const hdrRs = await client.request()
//         .input('RecordId', sql.Int, recordId)
//         .query(`SELECT TOP 1 EnquiryGenerationNewId, CalculationUnitId, CheckCBMWeightId,
//                       SegmentId, FromPinCodeId, ToLocationRouteId, CompanyId, LocationId
//                FROM EnquiryGenerationNew
//                WHERE EnquiryGenerationNewId = @RecordId`);
//       if (!hdrRs.recordset.length) return res.status(404).json({ error: 'Enquiry not found' });
//       hdr = hdrRs.recordset[0];

//       const cargoRs = await client.request()
//         .input('RecordId', sql.Int, recordId)
//         .query(`SELECT EnquiryDimensionsDetailsId, cNoofPackages, cLength, cWidth, cHeight,
//                        cCBM, cTotalPackageWeight, ChildstackableId
//                 FROM EnquiryDimensionsDetails
//                 WHERE EnquiryGenerationNewId = @RecordId`);
//       pkgRows = cargoRs.recordset || [];
//       if (!pkgRows.length) return res.status(200).json({ status: 'no-packages', message: 'No cargo rows found' });
//     } else {
//       if (!Array.isArray(bodyPackages) || bodyPackages.length === 0) {
//         return res.status(400).json({ error: 'Either recordId or packages array required' });
//       }
//       // Map body to same schema as DB rows
//       pkgRows = bodyPackages.map((p, idx) => ({
//         EnquiryDimensionsDetailsId: p.pkgId || idx + 1,
//         cNoofPackages: p.qty || p.count || 1,
//         cLength: p.length,
//         cWidth: p.width,
//         cHeight: p.height,
//         cCBM: p.cbm || null,
//         cTotalPackageWeight: p.weight || p.weightKg || 0,
//         ChildstackableId: (typeof p.stackable === 'boolean') ? (p.stackable ? 1 : 0) : 1
//       }));
//       hdr.CalculationUnitId = req.body.calculationUnitId || 3;
//     }

//     // --- 2) helpers ---
//     const unitToFeet = (value, unitId) => {
//       if (value == null) return 0;
//       switch (+unitId) {
//         case 1: return value / 30.48;    // cm -> ft
//         case 2: return value / 12.0;     // inch -> ft
//         case 3: return value;            // ft
//         case 4: return value * 3.28084;  // meter -> ft
//         case 5: return value / 304.8;    // mm -> ft
//         default: return value;
//       }
//     };

//     function packageFits3D(pkg, truck) {
//       const orientations = [
//         [pkg.lengthFt, pkg.widthFt, pkg.heightFt],
//         [pkg.lengthFt, pkg.heightFt, pkg.widthFt],
//         [pkg.widthFt, pkg.lengthFt, pkg.heightFt],
//         [pkg.widthFt, pkg.heightFt, pkg.lengthFt],
//         [pkg.heightFt, pkg.lengthFt, pkg.widthFt],
//         [pkg.heightFt, pkg.widthFt, pkg.lengthFt],
//       ];
//       return orientations.some(([l, w, h]) =>
//         l <= truck.usableLengthFt && w <= truck.usableWidthFt && h <= truck.usableHeightFt
//       );
//     }

//     // --- 3) build package types (do NOT expand to many entries) ---
//     const pkgs = pkgRows.map(r => {
//       const qty = Number(r.cNoofPackages || 1);
//       const Lft = unitToFeet(r.cLength || 0, hdr.CalculationUnitId);
//       const Wft = unitToFeet(r.cWidth || 0, hdr.CalculationUnitId);
//       const Hft = unitToFeet(r.cHeight || 0, hdr.CalculationUnitId);
//       const cbmPerPkg = (r.cCBM && r.cCBM > 0) ? Number(r.cCBM) : Number((Lft * Wft * Hft * 0.028316846592).toFixed(6));
//       const perPkgWeight = Number(r.cTotalPackageWeight || 0);
//       const stackable = (r.ChildstackableId == null) ? true : (r.ChildstackableId === 1);
//       return {
//         pkgId: r.EnquiryDimensionsDetailsId,
//         qty,
//         lengthFt: Number(Lft),
//         widthFt: Number(Wft),
//         heightFt: Number(Hft),
//         cbm: Number(cbmPerPkg),
//         weightKg: Number(perPkgWeight),
//         stackable
//       };
//     });

//     // quick totals & maxima (procedure-like)
//     const totalCBM = pkgs.reduce((s, p) => s + p.cbm * p.qty, 0);
//     const totalWeight = pkgs.reduce((s, p) => s + p.weightKg * p.qty, 0);
//     const totalPkgs = pkgs.reduce((s, p) => s + p.qty, 0);
//     let maxLen = 0, maxWid = 0, maxHei = 0, maxPkgWt = 0, maxPkgCBM = 0;
//     let allStackable = true;
//     for (const p of pkgs) {
//       maxLen = Math.max(maxLen, p.lengthFt);
//       maxWid = Math.max(maxWid, p.widthFt);
//       maxHei = Math.max(maxHei, p.heightFt);
//       maxPkgWt = Math.max(maxPkgWt, p.weightKg || 0);
//       maxPkgCBM = Math.max(maxPkgCBM, p.cbm || 0);
//       if (!p.stackable) allStackable = false;
//     }

//     // --- 4) fetch vehicles and capacity map (same as your original) ---
//     const vehRs = await client.request().query(`
//       SELECT v.VehicleTypeMasterId AS truckId, v.VehicleName AS truckName,
//              v.Length AS lengthFt, v.Width AS widthFt, v.Height AS heightFt,
//              ISNULL(v.CBMCapacity, 0) AS cbmCapacity, v.VehicleCapacityId
//       FROM VehicleTypeMaster v
//       ORDER BY v.CBMCapacity ASC
//     `);
//     const vehiclesRaw = vehRs.recordset || [];
//     if (!vehiclesRaw.length) return res.status(500).json({ error: 'No truck types found' });

//     const capRs = await client.request().query(`SELECT CapcityMasterId, CapacityInKg FROM CapcityMaster`);
//     const caps = {};
//     for (const c of capRs.recordset || []) caps[c.CapcityMasterId] = Number(c.CapacityInKg || 0);

//     const CLEAR_L = 0.25, CLEAR_W = 0.25, CLEAR_H = 0.25;
//     const vehicles = vehiclesRaw.map(v => ({
//       ...v,
//       maxWeightKg: caps[v.VehicleCapacityId] || 0,
//       usableLengthFt: Math.max(0, Number(v.lengthFt) - CLEAR_L),
//       usableWidthFt: Math.max(0, Number(v.widthFt) - CLEAR_W),
//       usableHeightFt: Math.max(0, Number(v.heightFt) - CLEAR_H),
//       cbmCapacity: Number(v.cbmCapacity || 0)
//     }));

//     // oversize single-package check (if any single package cannot fit into any truck by dims)
//     for (const p of pkgs) {
//       const fitsAny = vehicles.some(t => packageFits3D(p, t));
//       if (!fitsAny) {
//         return res.status(200).json({ status: 'oversize', message: `Package ${p.pkgId} cannot fit into any truck type`, package: p });
//       }
//     }

//     // --- 5) pick primary truck using proc-like heuristic (min vehicles) ---
//     const candTrucks = vehicles.filter(v =>
//       v.usableLengthFt >= maxLen &&
//       v.usableWidthFt >= maxWid &&
//       v.usableHeightFt >= maxHei &&
//       v.cbmCapacity >= maxPkgCBM &&
//       (v.maxWeightKg === 0 || v.maxWeightKg >= maxPkgWt)
//     );

//     // fallback CBM+weight-only if no dimension match (proc had this)
//     let primary = null;
//     if (candTrucks.length === 0) {
//       primary = vehicles.find(v =>
//         v.cbmCapacity >= totalCBM &&
//         (v.maxWeightKg === 0 || v.maxWeightKg >= totalWeight)
//       ) || null;

//       if (primary) {
//         // simple suggestion based on totals as proc does
//         return res.status(200).json({
//           status: 'cbm-weight-match',
//           message: 'Suggested based on total CBM & total weight',
//           suggestion: { truckId: primary.truckId, truckName: primary.truckName }
//         });
//       }
//     } else {
//       // evaluate each candidate using proc heuristic: fitLen * fitWid * fitHei => pkgPerVeh => vehNeeded
//       let best = null;
//       for (const t of candTrucks) {
//         const fitLen = Math.max(1, Math.floor(t.usableLengthFt / (maxLen || 1)));
//         const fitWid = Math.max(1, Math.floor(t.usableWidthFt / (maxWid || 1)));
//         const fitHei = allStackable ? Math.max(1, Math.floor(t.usableHeightFt / (maxHei || 1))) : 1;
//         const pkgPerVeh = Math.max(1, fitLen * fitWid * fitHei);
//         const vehNeeded = Math.ceil(totalPkgs / pkgPerVeh);
//         if (!best || vehNeeded < best.vehNeeded || (vehNeeded === best.vehNeeded && t.cbmCapacity < best.t.cbmCapacity)) {
//           best = { t, pkgPerVeh, vehNeeded };
//         }
//       }
//       primary = best ? best.t : candTrucks[0];
//     }

//     if (!primary) return res.status(500).json({ error: 'No primary truck found' });


//     const allocationsInstances = []; // each item: { truck, usedWeight, usedCBM, items: [ 
//     const fitLenPrimary = Math.max(1, Math.floor(primary.usableLengthFt / (maxLen || 1)));
//     const fitWidPrimary = Math.max(1, Math.floor(primary.usableWidthFt / (maxWid || 1)));
//     const fitHeiPrimary = allStackable ? Math.max(1, Math.floor(primary.usableHeightFt / (maxHei || 1))) : 1;
//     const pkgPerVehPrimary = Math.max(1, fitLenPrimary * fitWidPrimary * fitHeiPrimary);
//     let estVehNeeded = Math.ceil(totalPkgs / pkgPerVehPrimary);

//     // create estVehNeeded empty instances
//     for (let i = 0; i < estVehNeeded; i++) allocationsInstances.push({
//       truckId: primary.truckId,
//       truckName: primary.truckName,
//       truckObj: primary,
//       usedWeight: 0,
//       usedCBM: 0,
//       items: [] // {pkgRef, qty}
//     });

//     // function to try to place one unit of a package into first available instance
//     function tryPlaceOne(pkg) {
//       // try instances in order (fill first)
//       for (const inst of allocationsInstances) {
//         const truck = inst.truckObj;
//         // check orientation (single unit fits)
//         if (!packageFits3D(pkg, truck)) continue;
//         // check cumulative constraints
//         if (truck.maxWeightKg > 0 && (inst.usedWeight + pkg.weightKg) > truck.maxWeightKg) continue;
//         const truckCBM = truck.cbmCapacity || (truck.usableLengthFt * truck.usableWidthFt * truck.usableHeightFt * 0.028316846592);
//         if ((inst.usedCBM + pkg.cbm) > truckCBM) continue;
//         // place one unit
//         inst.usedWeight += pkg.weightKg;
//         inst.usedCBM += pkg.cbm;
//         // push item summary (merge same pkgId if exists)
//         const ex = inst.items.find(x => x.pkgId === pkg.pkgId && x.lengthFt === pkg.lengthFt && x.widthFt === pkg.widthFt && x.heightFt === pkg.heightFt);
//         if (ex) ex.qty += 1;
//         else inst.items.push({ pkgId: pkg.pkgId, qty: 1, lengthFt: pkg.lengthFt, widthFt: pkg.widthFt, heightFt: pkg.heightFt, cbm: pkg.cbm, weightKg: pkg.weightKg });
//         return true;
//       }
//       return false;
//     }

//     // Attempt to place all packages (unit by unit) into primary instances
//     const remainingPkgs = pkgs.map(p => ({ ...p })); // shallow copy with qty counters
//     for (const p of remainingPkgs) {
//       while (p.qty > 0) {
//         // If no instance fits even 1 unit, break so we can try adding another instance later
//         if (!tryPlaceOne(p)) break;
//         p.qty -= 1;
//       }
//     }
    
//     let remainingCount = remainingPkgs.reduce((s, x) => s + x.qty, 0);
//     let addCap = Math.max(Math.ceil(estVehNeeded * 0.10), 5);
//     while (remainingCount > 0 && addCap > 0) {
//       // add one more primary instance and try to place
//       allocationsInstances.push({
//         truckId: primary.truckId,
//         truckName: primary.truckName,
//         truckObj: primary,
//         usedWeight: 0,
//         usedCBM: 0,
//         items: []
//       });
//       // try place again for remaining
//       for (const p of remainingPkgs) {
//         while (p.qty > 0) {
//           if (!tryPlaceOne(p)) break;
//           p.qty -= 1;
//         }
//       }
//       remainingCount = remainingPkgs.reduce((s, x) => s + x.qty, 0);
//       addCap--;
//     }

//     // If still remaining, we try other vehicles ascending by cbmCapacity (smaller ones first)
//     if (remainingPkgs.some(p => p.qty > 0)) {
//       const otherVehicles = vehicles.slice().sort((a, b) => a.cbmCapacity - b.cbmCapacity);
//       for (const v of otherVehicles) {
//         // skip primary already tried (we already used many instances)
//         if (v.truckId === primary.truckId) continue;
//         // quick check: does vehicle have enough raw dims to fit the max package dims?
//         if (v.usableLengthFt < maxLen || v.usableWidthFt < maxWid || v.usableHeightFt < (allStackable ? maxHei : maxHei)) continue;
//         // create one instance at a time and attempt to fill until no remaining or no more fit
//         let created = 0;
//         while (remainingPkgs.some(p => p.qty > 0)) {
//           // check if this vehicle can fit any remaining single unit
//           const canFitAny = remainingPkgs.some(p => p.qty > 0 && packageFits3D(p, v) && (v.maxWeightKg === 0 || p.weightKg <= v.maxWeightKg) && p.cbm <= v.cbmCapacity);
//           if (!canFitAny) break;
//           // create instance
//           const inst = { truckId: v.truckId, truckName: v.truckName, truckObj: v, usedWeight: 0, usedCBM: 0, items: [] };
//           allocationsInstances.push(inst);
//           created++;
//           // local helper to place one in this newly created inst
//           const tryPlaceOneInInst = (pkg) => {
//             const truck = inst.truckObj;
//             if (!packageFits3D(pkg, truck)) return false;
//             if (truck.maxWeightKg > 0 && (inst.usedWeight + pkg.weightKg) > truck.maxWeightKg) return false;
//             const truckCBM = truck.cbmCapacity || (truck.usableLengthFt * truck.usableWidthFt * truck.usableHeightFt * 0.028316846592);
//             if ((inst.usedCBM + pkg.cbm) > truckCBM) return false;
//             // place
//             inst.usedWeight += pkg.weightKg;
//             inst.usedCBM += pkg.cbm;
//             const ex = inst.items.find(x => x.pkgId === pkg.pkgId && x.lengthFt === pkg.lengthFt && x.widthFt === pkg.widthFt && x.heightFt === pkg.heightFt);
//             if (ex) ex.qty += 1;
//             else inst.items.push({ pkgId: pkg.pkgId, qty: 1, lengthFt: pkg.lengthFt, widthFt: pkg.widthFt, heightFt: pkg.heightFt, cbm: pkg.cbm, weightKg: pkg.weightKg });
//             return true;
//           };
//           // Try to fill this instance greedily from remainingPkgs (largest-first is better)
//           remainingPkgs.sort((a, b) => (b.cbm - a.cbm)); // heavier CBM first
//           for (const p of remainingPkgs) {
//             while (p.qty > 0) {
//               if (!tryPlaceOneInInst(p)) break;
//               p.qty -= 1;
//             }
//           }
//           // If we created too many instances without placing anything, break to avoid infinite loop
//           if (created > 1000) break;
//         }
//         // stop if nothing remains
//         if (!remainingPkgs.some(p => p.qty > 0)) break;
//       }
//     }

//     // now verify remaining
//     const finalRemaining = remainingPkgs.reduce((s, x) => s + x.qty, 0);
//     if (finalRemaining > 0) {
//       return res.status(200).json({
//         status: 'partial_allocated',
//         message: `Allocated ${totalPkgs - finalRemaining}/${totalPkgs}. ${finalRemaining} remain`,
//         allocations: allocationsInstances.map(inst => ({
//           truckId: inst.truckId,
//           truckName: inst.truckName,
//           qty: inst.items.reduce((s, it) => s + it.qty, 0),
//           usedCBM: inst.usedCBM,
//           usedWeightKg: inst.usedWeight
//         })),
//         remainingCount: finalRemaining,
//         remainingSample: remainingPkgs.filter(p => p.qty > 0).slice(0, 5)
//       });
//     }

//     // --- 7) aggregate instances to finalAllocations grouped by truckId (qty = number of instances of that truck) ---
//     const grouped = {};
//     for (const inst of allocationsInstances) {
//       if (!grouped[inst.truckId]) grouped[inst.truckId] = { truckId: inst.truckId, truckName: inst.truckName, qty: 0, usedCBM: 0, usedWeightKg: 0 };
//       grouped[inst.truckId].qty += 1;
//       grouped[inst.truckId].usedCBM += inst.usedCBM;
//       grouped[inst.truckId].usedWeightKg += inst.usedWeight;
//     }
//     const finalAllocations = Object.values(grouped);

//     // --- 8) Pricing mirror (MapVehicle -> TruckingContractsRate -> Appreciation -> ExchangeRates) ---
//     const suggestions = [];
//     let totalTruckingChargesInUSD = 0;
//     for (const alloc of finalAllocations) {
//       const mvRs = await client.request().input('VehicleId', sql.Int, alloc.truckId)
//         .query(`SELECT TOP 1 ColumnName FROM MapVehicle WHERE VehicleId = @VehicleId`);
//       const mapCol = mvRs.recordset[0] ? mvRs.recordset[0].ColumnName : null;
//       let rateVal = 0, currencyId = null;
//       if (mapCol) {
//         const qcol = '[' + mapCol.replace(']', '') + ']';
//         const dyn = `SELECT TOP 1 ${qcol} AS RateVal, tcr.CurrencyId FROM TruckingContractsRate tcr WHERE tcr.PickupLocationId = @FromPinCodeId AND tcr.FinalLocationId = ISNULL(@ToLocationId, @ToLocationRouteId)`;
//         const rateRs = await client.request()
//           .input('FromPinCodeId', sql.Int, hdr.FromPinCodeId || 0)
//           .input('ToLocationId', sql.Int, hdr.LocationId || 0)
//           .input('ToLocationRouteId', sql.Numeric(18, 3), hdr.ToLocationRouteId || 0)
//           .query(dyn);
//         if (rateRs.recordset[0]) { rateVal = Number(rateRs.recordset[0].RateVal || 0); currencyId = rateRs.recordset[0].CurrencyId; }
//       }
//       const appRs = await client.request()
//         .input('CompanyId', sql.Int, hdr.CompanyId || 0)
//         .input('SegmentId', sql.Int, hdr.SegmentId || 0)
//         .query(`SELECT TOP 1 AppreciationPer FROM AppreciationConfiguration WHERE CompanyId=@CompanyId AND SegmentId=@SegmentId ORDER BY AppreciationConfigurationId DESC`);
//       const appreciation = (appRs.recordset[0] && appRs.recordset[0].AppreciationPer) ? Number(appRs.recordset[0].AppreciationPer) : 0;
//       const rateAfterApp = rateVal + (rateVal * appreciation / 100.0);
//       let exch = 1;
//       if (currencyId) {
//         const exRs = await client.request()
//           .query(`SELECT TOP 1 ExchageRateCurrencyToUsd FROM ExchangeRatesDetails WHERE ExchangeRatesHdrId = (SELECT MAX(ExchangeRatesHdrId) FROM ExchangeRatesHdr) AND CurrencyId = ${Number(currencyId)}`);
//         if (exRs.recordset[0]) exch = Number(exRs.recordset[0].ExchageRateCurrencyToUsd || 1);
//       }
//       suggestions.push({ truckId: alloc.truckId, truckName: alloc.truckName, usedCBM: alloc.usedCBM, usedWeightKg: alloc.usedWeightKg, chargePerTruck: rateAfterApp, chargePerTruckUSD: rateAfterApp * exch });
//       totalTruckingChargesInUSD += (rateAfterApp * exch) * alloc.qty;
//     }

//     // --- 9) persist if requested ---
//     if (persist && recordId) {
//       // delete previous auto-generated charges
//       await client.request().input('RecordId', sql.Int, recordId).query(`DELETE FROM EnquiryChargesDetails WHERE EnquiryGenerationNewID = @RecordId AND ChargeCalcId = 2`);
//       for (const s of suggestions) {
//         await client.request()
//           .input('RecordId', sql.Int, recordId)
//           .input('UserId', sql.Int, userId)
//           .input('CompanyId', sql.Int, hdr.CompanyId || 0)
//           .input('LocationId', sql.Int, hdr.LocationId || 0)
//           .input('VehicleId', sql.Int, s.truckId)
//           .input('ChargeAmount', sql.Numeric(18, 6), s.chargePerTruck || 0)
//           .input('ChargeAmountInUSD', sql.Numeric(18, 6), (s.chargePerTruckUSD || 0) * s.qty)
//           .query(`
//             INSERT INTO EnquiryChargesDetails
//               (EnquiryGenerationNewID, kz_UserId, kz_CompanyId, kz_PageMasterId, kz_LocationId, Temp_EntryType, VehicleId, ChargeAmount, ChargeCalcId, CurrencyId, ChargeAmountInUSD, InternalNote)
//             VALUES
//               (@RecordId, @UserId, @CompanyId, 0, @LocationId, 0, @VehicleId, @ChargeAmount, 2, 1, @ChargeAmountInUSD,
//                (SELECT VehicleName FROM VehicleTypeMaster WHERE VehicleTypeMasterId = @VehicleId) + ' × ' + CAST(${s.qty || 1} AS NVARCHAR(10)))
//           `);
//       }

//       // update header (simplified like original)
//       await client.request()
//         .input('RecordId', sql.Int, recordId)
//         .input('SuggestOneVehicle', sql.NVarChar(sql.MAX), finalAllocations.map(x => `${x.truckName} × ${x.qty}`).join(', '))
//         .input('VehicleTypeMasterId', sql.NVarChar(sql.MAX), finalAllocations.map(x => x.truckId).join(','))
//         .input('EnRatesPerVehicle', sql.NVarChar(sql.MAX), suggestions.map(x => (x.chargePerTruck || 0).toFixed(3)).join(','))
//         .input('TotalUSD', sql.Numeric(18, 3), totalTruckingChargesInUSD)
//         .query(`
//           UPDATE EnquiryGenerationNew
//           SET SuggestOneVehicle = @SuggestOneVehicle,
//               VehicleTypeMasterId = @VehicleTypeMasterId,
//               EnRatesPerVehicle = @EnRatesPerVehicle,
//               TotalTruckingChargesInUSD = @TotalUSD
//           WHERE EnquiryGenerationNewId = @RecordId
//         `);
//     }

//     // --- 10) final validation: ensure no overloaded instance (should not happen) ---
//     for (const inst of allocationsInstances) {
//       const truckInfo = vehicles.find(v => v.truckId === inst.truckId);
//       if (truckInfo && (inst.usedWeight > truckInfo.maxWeightKg || inst.usedCBM > truckInfo.cbmCapacity)) {
//         return res.status(200).json({
//           status: 'invalid-allocation',
//           message: `Truck ${truckInfo.truckName} overloaded — please select a bigger truck`,
//           truck: truckInfo,
//           usedWeight: inst.usedWeight,
//           usedCBM: inst.usedCBM
//         });
//       }
//     }

//     return res.status(200).json({
//       status: 'success',
//       message: 'All packages allocated',
//       allocations: finalAllocations,
//       totalTruckingChargesInUSD
//     });

//   } catch (err) {
//     console.error('suggestTruckForEnquiry error:', err);
//     return res.status(500).json({ error: 'Internal error', details: err.message });
//   }
// }

// module.exports = { suggestTruckForEnquiry };


