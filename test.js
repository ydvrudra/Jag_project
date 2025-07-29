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







// require("dotenv").config();
// const express = require("express");
// const fs = require("fs");
// const path = require("path");
// const axios = require("axios");
// const cors = require("cors");
// const cheerio = require("cheerio");
// const XLSX = require("xlsx"); // ✅ NEW

// const app = express();
// const port = 3000;

// app.use(cors());
// app.use(express.json());

// // Setup upload directory
// const uploadDir = path.join(__dirname, "uploads");
// if (!fs.existsSync(uploadDir)) {
//   fs.mkdirSync(uploadDir);
//   console.log(" Created 'uploads' directory");
// } else {
//   console.log(" 'uploads' directory already exists");
// }

// // 🔹 Route 1: Download all invoices from remote server
// app.get("/download-all-invoices", async (req, res) => {
//   try {
//     const baseUrl = "http://sja.jagsoftware.in/UserData/Invoices/";
//     const html = await axios.get(baseUrl);
//     const $ = cheerio.load(html.data);

//     const pdfLinks = [];

//     $("a").each((_, el) => {
//       const href = $(el).attr("href");
//       if (href && href.toLowerCase().includes(".pdf")) {
//         try {
//           const fullUrl = new URL(href, baseUrl).href;
//           if (fullUrl.toLowerCase().endsWith(".pdf")) {
//             pdfLinks.push(fullUrl);
//           }
//         } catch (err) {
//           console.warn(` Skipping invalid href: ${href}`);
//         }
//       }
//     });

//     if (pdfLinks.length === 0) {
//       return res.json({ message: "No PDF files found on remote server." });
//     }

//     console.log(` Found ${pdfLinks.length} PDF files.`);

//     const downloaded = [];
//     const skipped = [];
//     const failed = [];

//     for (const fileUrl of pdfLinks) {
//       const fileName = fileUrl.split("/").pop();
//       const localPath = path.join(uploadDir, fileName);

//       if (fs.existsSync(localPath)) {
//         console.log(` Skipped (already exists): ${fileName}`);
//         skipped.push(fileName);
//         continue;
//       }

//       try {
//         console.log(`  Downloading: ${fileName}`);
//         const writer = fs.createWriteStream(localPath);
//         const fileResponse = await axios({
//           url: fileUrl,
//           method: "GET",
//           responseType: "stream",
//         });

//         await new Promise((resolve, reject) => {
//           fileResponse.data.pipe(writer);
//           writer.on("finish", () => {
//             console.log(` Downloaded: ${fileName}`);
//             resolve();
//           });
//           writer.on("error", (err) => {
//             console.error(` Stream error: ${err.message}`);
//             reject(err);
//           });
//         });

//         downloaded.push(fileName);
//       } catch (err) {
//         console.error(` Failed to download ${fileName}: ${err.message}`);
//         failed.push({ file: fileName, reason: err.message });
//       }
//     }

//     res.json({
//       status: "completed",
//       total_found: pdfLinks.length,
//       downloaded_count: downloaded.length,
//       skipped_count: skipped.length,
//       failed_count: failed.length,
//       downloaded_files: downloaded,
//       skipped_files: skipped,
//       failed_files: failed,
//     });
//   } catch (err) {
//     console.error("Error scraping or downloading:", err.message);
//     res.status(500).json({
//       error: "Failed to fetch or download invoices",
//       details: err.message,
//     });
//   }
// });

// // 🔹 Route 2: Process local invoices in uploads/ with mock logic
// app.get("/process-local-invoices", async (req, res) => {
//   try {
//     const files = fs.readdirSync(uploadDir);
//     const pdfFiles = files.filter(f => f.toLowerCase().endsWith(".pdf"));

//     if (pdfFiles.length === 0) {
//       return res.json({ message: "No PDF files found in 'uploads' folder." });
//     }

//     const extractedData = [];

//     for (const fileName of pdfFiles) {
//       const mock = {
//         file: fileName,
//         invoice_number: "INV-" + Math.floor(Math.random() * 100000),
//         vendor: "Mock Vendor Pvt Ltd",
//         invoice_date: new Date().toISOString().split("T")[0],
//         total_amount: "₹" + (Math.random() * 10000 + 1000).toFixed(2),
//         currency: "INR",
//         status: "mocked"
//       };

//       extractedData.push(mock);
//     }

//     res.json({
//       status: "processed",
//       total_files: pdfFiles.length,
//       extracted_data: extractedData
//     });

//   } catch (err) {
//     console.error("Error processing local files:", err.message);
//     res.status(500).json({
//       error: "Failed to process local invoices",
//       details: err.message
//     });
//   }
// });

// // 🔹 Route 3: Export mock data to Excel
// app.get("/export-invoices-excel", async (req, res) => {
//   try {
//     const files = fs.readdirSync(uploadDir);
//     const pdfFiles = files.filter(f => f.toLowerCase().endsWith(".pdf"));

//     if (pdfFiles.length === 0) {
//       return res.json({ message: "No PDF files in uploads/ to export." });
//     }

//     const extractedData = pdfFiles.map(fileName => ({
//       file: fileName,
//       invoice_number: "INV-" + Math.floor(Math.random() * 100000),
//       vendor: "Mock Vendor Pvt Ltd",
//       invoice_date: new Date().toISOString().split("T")[0],
//       total_amount: (Math.random() * 10000 + 1000).toFixed(2),
//       currency: "INR",
//       status: "mocked"
//     }));

//     const worksheet = XLSX.utils.json_to_sheet(extractedData);
//     const workbook = XLSX.utils.book_new();
//     XLSX.utils.book_append_sheet(workbook, worksheet, "Invoices");

//     const filePath = path.join(__dirname, "invoices.xlsx");
//     XLSX.writeFile(workbook, filePath);

//     console.log("Excel generated:", filePath);
//     res.download(filePath, "invoices.xlsx");

//   } catch (err) {
//     console.error(" Error exporting to Excel:", err.message);
//     res.status(500).json({
//       error: "Failed to export invoices to Excel",
//       details: err.message
//     });
//   }
// });

// //  Start the server
// app.listen(port, () => {
//   console.log(` Server running at http://localhost:${port}`);
// });