require("dotenv").config();
const sql = require("mssql");

const sqlCfg = {
  user: process.env.SQLSERVER_USER,
  password: process.env.SQLSERVER_PASSWORD,
  server: process.env.SQLSERVER_SERVER,
  port: Number(process.env.SQLSERVER_PORT) || 1433,
  database: process.env.SQLSERVER_DATABASE,
  connectionTimeout: 60000,
  requestTimeout: 60000,
  options: {
    encrypt: true,
    enableArithAbort: true,
    trustServerCertificate: true
  },
  pool: { max: 20, min: 5, idleTimeoutMillis: 60000,  acquireTimeoutMillis: 60000 },
};

const pool = new sql.ConnectionPool(sqlCfg);
const poolConnect = pool.connect();

poolConnect.then(() => {
  console.log('✅ Database connected successfully');
}).catch(err => {
  console.error('❌ Database connection failed:', err.message);
});

module.exports = { sql, pool, poolConnect };