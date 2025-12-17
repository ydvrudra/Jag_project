require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const invoiceRoutes = require("./routes/invoiceRoutes");

const app = express();
const port = 3000;

const tempDir = path.join(__dirname, "temp_processing");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
  console.log(`📁 Created temp directory: ${tempDir}`);
}


app.use(cors());
app.use(express.json());
app.use("/", invoiceRoutes);

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});