//config/sqlConfig.js
require("dotenv").config();
const sql = require("mssql");

const sqlCfg = {
  user: process.env.SQLSERVER_USER,
  password: process.env.SQLSERVER_PASSWORD,
  server: process.env.SQLSERVER_SERVER,
  port: Number(process.env.SQLSERVER_PORT) || 1433,
  database: process.env.SQLSERVER_DATABASE,
  connectionTimeout: 300000,
  requestTimeout: 300000,
  options: {
    encrypt: true,
    enableArithAbort: true,
    trustServerCertificate: true
  },
  pool: { max: 10, min: 2, idleTimeoutMillis: 120000,  acquireTimeoutMillis: 180000 },
};

const pool = new sql.ConnectionPool(sqlCfg);
const poolConnect = pool.connect();

poolConnect.then(() => {
  console.log(' Database connected successfully');
}).catch(err => {
  console.error('❌ Database connection failed:', err.message);
});

module.exports = { sql, pool, poolConnect };