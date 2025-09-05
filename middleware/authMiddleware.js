const { pool, poolConnect, sql } = require('../services/dbWriter');

async function verifyUser(req, res, next) {
  const { username, password } = req.headers;

  // ✅ Bypass if already verified userId is passed from Kaizen or SQL
  if (req.headers['x-user-verified'] === 'true') {
    return next();
  }

  if (!username || !password) {
    return res.status(401).json({ error: "Username and password required" });
  }

  try {
    const pool = await sql.connect(dbConfig);
    const request = pool.request();
    request.input("Username", sql.VarChar(100), username);
    request.input("password", sql.VarChar(100), password);

    const result = await request.query("SELECT dbo.Fn_VerifyUser(@Username, @password) AS UserId");
    const userId = result.recordset[0]?.UserId;

    if (!userId || userId === 0) {
      return res.status(403).json({ error: "Invalid credentials" });
    }

    req.userId = userId;
    next();
  } catch (err) {
    console.error("Auth error:", err.message);
    return res.status(500).json({ error: "Internal server error during authentication" });
  }
}


module.exports = verifyUser;
