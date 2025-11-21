// routes/truckRoutes.js
const express = require('express');
const { suggestTruckForEnquiry } = require('../controller/truckController.js');
//const verifyUser = require('../middleware/authMiddleware'); // use your existing middleware

const router = express.Router();

router.post('/truck/suggest', suggestTruckForEnquiry);

module.exports = router;
