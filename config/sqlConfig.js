// config/sqlConfig.js
require("dotenv").config();
const sql = require("mssql");

const sqlCfg = {
  user: process.env.SQLSERVER_USER,
  password: process.env.SQLSERVER_PASSWORD,
  server: process.env.SQLSERVER_SERVER || "localhost",
  port: Number(process.env.SQLSERVER_PORT) || 1433,
  database: process.env.SQLSERVER_DATABASE,
  options: { trustServerCertificate: (process.env.SQLSERVER_TRUSTCERT || "true") === "true" },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

const pool = new sql.ConnectionPool(sqlCfg);
const poolConnect = pool.connect();

module.exports = { sql, pool, poolConnect };
