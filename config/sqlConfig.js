require("dotenv").config();
const sql = require("mssql");

const sqlCfg = {
  user: process.env.SQLSERVER_USER,
  password: process.env.SQLSERVER_PASSWORD,
  server: process.env.SQLSERVER_SERVER,
  port: Number(process.env.SQLSERVER_PORT) || 1433,
  database: process.env.SQLSERVER_DATABASE,
  options: { 
    trustServerCertificate: true,
    encrypt: false // Add this for external servers
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

const pool = new sql.ConnectionPool(sqlCfg);
const poolConnect = pool.connect();

poolConnect.then(() => {
  console.log('✅ Database connected successfully');
}).catch(err => {
  console.error('❌ Database connection failed:', err.message);
});

module.exports = { sql, pool, poolConnect };