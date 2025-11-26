// controllers/truckController.js
const { pool, poolConnect } = require('../config/sqlConfig');
const { loadHeaderAndPackages, loadVehiclesAndCapacities, packageFits3D } = require('../truckHelpers/loadData');
const { allocateTrucksAndPrice } = require('../truckHelpers/truckAllocation');

async function suggestTruckForEnquiry(req, res) {
  await poolConnect;
  const client = pool;
  const { recordId, packages: bodyPackages = [], userId = 0, persist = false } = req.body || {};

  try {
    // --- 1) Load header & packages ---
    const { hdr, pkgs } = await loadHeaderAndPackages(client, recordId, bodyPackages, req.body.calculationUnitId);

    if (!pkgs.length) {
      return res.status(200).json({ status: 'no-packages', message: 'No packages found' });
    }

    // --- 2) Load vehicles & capacities ---
    const vehicles = await loadVehiclesAndCapacities(client);

    if (!vehicles.length) {
      return res.status(500).json({ status: 'no-vehicles', message: 'No truck types found' });
    }

    // --- 3) Allocate trucks & calculate charges ---
    const result = await allocateTrucksAndPrice({
      client,
      hdr,
      pkgs,
      vehicles,
      persist,
      recordId,
      userId,
      packageFits3D
    });

    // ✅ ADD DATABASE UPDATE HERE
    if (recordId && result.status === 'success') {
      try {
        const truckIds = result.allocations.map(alloc => alloc.truckId).join(',');
        
        const updateQuery = `
          UPDATE EnquiryGenerationNew 
          SET VehicleTypeMasterId = @truckIds,
              SuggestOneVehicle = @suggestionsJson
          WHERE EnquiryGenerationNewId = @recordId
        `;
        
        await client.request()
          .input('truckIds', sql.VarChar, truckIds)
          .input('suggestionsJson', sql.NVarChar, JSON.stringify(result.allocations))
          .input('recordId', sql.Int, recordId)
          .query(updateQuery);
          
        console.log('✅ Truck IDs saved:', truckIds);
      } catch (updateError) {
        console.error('Error saving truck IDs:', updateError);
      }
    }

    return res.status(200).json(result);

  } catch (err) {
    console.error('suggestTruckForEnquiry error:', err);
    return res.status(500).json({ error: 'Internal error', details: err.message });
  }
}

module.exports = { suggestTruckForEnquiry };
