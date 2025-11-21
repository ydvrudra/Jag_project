//truckHelpers/truckDataLoader.js
module.exports = async function loadTruckData(client, sql) {
  const query = `
    SELECT TruckId, TruckName, TruckType, CapacityWeightKg, CapacityCFT,
           LengthFt, WidthFt, HeightFt, TruckBaseFare, PerKmRate,
           IsActive
    FROM dbo.TruckMaster
    WHERE IsActive = 1
  `;
  const rs = await client.request().query(query);
  return rs.recordset || [];
};
