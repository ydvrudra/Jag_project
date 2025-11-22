//truckHelpers/truckDataLoader.js
module.exports = async function loadTruckData(client, sql) {
  const query = `
    SELECT 
      VehicleTypeMasterId AS TruckId, 
      VehicleName AS TruckName,
      Length AS LengthFt, 
      Width AS WidthFt, 
      Height AS HeightFt,
      ISNULL(CBMCapacity, 0) AS CapacityCFT,
      VehicleCapacityId
    FROM dbo.VehicleTypeMaster
    WHERE IsActive = 1
  `;
  const rs = await client.request().query(query);
  return rs.recordset || [];
};