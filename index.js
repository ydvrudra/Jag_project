require("dotenv").config();
const express = require("express");
const cors = require("cors");
const invoiceRoutes = require("./routes/invoiceRoutes");

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());


app.use("/", invoiceRoutes);

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});




