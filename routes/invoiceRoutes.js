//routes/invoiceRoutes.js
const express = require("express");
const verifyUser = require("../middleware/authMiddleware");
const { downloadExcelFile,processInvoiceList } = require("../controller/invoiceController");


const router = express.Router();

router.post("/process-all-invoices", verifyUser, processInvoiceList);
router.get("/download-excel",verifyUser, downloadExcelFile);
//router.get("/fetch-exchange-rates", fetchExchangeRates);

module.exports = router;

