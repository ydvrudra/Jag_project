require("dotenv").config();
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const axios = require("axios");
const path = require("path");
const cors = require("cors");

const app = express();
const port = 3000;

// Allow frontend to access backend
app.use(
  cors({
    origin: "http://localhost:5174",
    methods: ["GET", "POST"],
    credentials: true,
  })
);

// Serve static files from uploads folder
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Setup multer for file upload
const upload = multer({ dest: "uploads/" });

// POST route to upload invoice and analyze using Azure Form Recognizer
app.post("/analyze-invoice", upload.single("file"), async (req, res) => {
  try {
    const filePath = path.resolve(req.file.path);
    const fileData = fs.readFileSync(filePath);

    console.log("📄 Uploaded file:", req.file.originalname);

    // Send file to Azure Form Recognizer
    const response = await axios.post(
      `${process.env.AZURE_ENDPOINT}formrecognizer/documentModels/prebuilt-invoice:analyze?api-version=2023-07-31`,
      fileData,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Ocp-Apim-Subscription-Key": process.env.AZURE_KEY,
        },
      }
    );

    const resultUrl = response.headers["operation-location"];
    console.log("🔗 Operation-Location:", resultUrl);

    // Poll Azure until we get a final status
    const getResult = async () => {
      while (true) {
        const pollResponse = await axios.get(resultUrl, {
          headers: {
            "Ocp-Apim-Subscription-Key": process.env.AZURE_KEY,
          },
        });

        const status = pollResponse.data.status;
        console.log("⏳ Azure Status:", status);

        if (status === "succeeded") return pollResponse.data;
        if (status === "failed") throw new Error("Azure failed to analyze document");

        // Wait before polling again
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    };

    const result = await getResult();

    // Return result to frontend
    res.json({
      fileUrl: `http://localhost:${port}/uploads/${req.file.filename}`,
      data: result,
    });
  } catch (err) {
    console.error("❌ Error:", err.response?.data || err.message);
    res.status(500).send("Failed to analyze invoice");
  }
});

// Start the server
app.listen(port, () => {
  console.log(`🚀 Server running on: http://localhost:${port}`);
});




