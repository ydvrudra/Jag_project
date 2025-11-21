//routes/invoiceRoutes.js
const express = require("express");
const verifyUser = require("../middleware/authMiddleware");
const {  processAllInvoices,downloadExcelFile,fetchExchangeRates} = require("../controller/invoiceController");


const router = express.Router();

router.get("/process-all-invoices", verifyUser, processAllInvoices);
router.get("/download-excel",verifyUser, downloadExcelFile);
router.get("/fetch-exchange-rates", fetchExchangeRates);

module.exports = router;

