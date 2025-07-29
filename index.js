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







// require("dotenv").config();
// const express = require("express");
// const fs = require("fs");
// const path = require("path");
// const axios = require("axios");
// const cors = require("cors");
// const cheerio = require("cheerio");
// const XLSX = require("xlsx");
// const ftp = require("basic-ftp");

// const app = express();
// const port = 3000;

// app.use(cors());
// app.use(express.json());

// const uploadDir = path.join(__dirname, "uploads");
// if (!fs.existsSync(uploadDir)) {
//   fs.mkdirSync(uploadDir);
//   console.log("Created 'uploads' directory");
// }

// const extractedExcelFile = path.join(__dirname, "Extracted_Invoices.xlsx");

// // 🔹 FTP Upload Function
// async function uploadToFtp(localPath, remoteFileName) {
//   const client = new ftp.Client();
//   try {
//     await client.access({
//       host: process.env.FTP_HOST,
//       user: process.env.FTP_USER,
//       password: process.env.FTP_PASSWORD,
//       secure: false,
//     });

//     const remotePath = `${process.env.FTP_REMOTE_DIR.replace(/\/$/, "")}/${remoteFileName}`;
//     console.log("Uploading to:", remotePath);
//     await client.uploadFrom(localPath, remotePath);
//     console.log("✅ FTP Upload Success:", remoteFileName);
//   } catch (err) {
//     console.error("FTP Upload Failed:", remoteFileName, err.message);
//     throw err;
//   } finally {
//     client.close();
//   }
// }

// // 🔹 Azure Analysis Function
// async function analyzeInvoiceWithAzure(filePath) {
//   const apiUrl = `${process.env.AZURE_ENDPOINT}/formrecognizer/documentModels/prebuilt-invoice:analyze?api-version=2023-07-31`;
//   const fileData = fs.readFileSync(filePath);

//   try {
//     const res = await axios.post(apiUrl, fileData, {
//       headers: {
//         "Content-Type": "application/pdf",
//         "Ocp-Apim-Subscription-Key": process.env.AZURE_KEY,
//       },
//     });

//     const operationLocation = res.headers["operation-location"];
//     let result;
//     let tries = 0;
//     while (tries < 10) {
//       await new Promise((r) => setTimeout(r, 3000));
//       const statusRes = await axios.get(operationLocation, {
//         headers: { "Ocp-Apim-Subscription-Key": process.env.AZURE_KEY },
//       });

//       if (statusRes.data.status === "succeeded") {
//         result = statusRes.data.analyzeResult;
//         break;
//       }
//       tries++;
//     }

//     if (!result) throw new Error("Azure invoice analysis failed or timed out");

//    // const doc = result.documents[0];
//    return {
//   file: path.basename(filePath),
//   full_json: result, // full Azure data
// };

//   } catch (err) {
//     console.error("❌ Azure analysis error:", err.message);
//     return null;
//   }
// }

// // 🔹 Save Extracted Data to Excel
// function saveToExcel(dataArray) {
//   const flatData = dataArray.map(item => {
//     const doc = item.full_json?.documents?.[0]?.fields || {};
//     const flatObj = {
//       File: item.file,
//     };

//     for (const [key, val] of Object.entries(doc)) {
//       flatObj[key] = val?.value || val?.content || "";
//     }

//     return flatObj;
//   });

//   let workbook;
//   let worksheet;

//   if (fs.existsSync(extractedExcelFile)) {
//     workbook = XLSX.readFile(extractedExcelFile);
//     worksheet = workbook.Sheets["Invoices"];
//     const existingData = XLSX.utils.sheet_to_json(worksheet);
//     const merged = [...existingData, ...flatData];
//     worksheet = XLSX.utils.json_to_sheet(merged);
//   } else {
//     workbook = XLSX.utils.book_new();
//     worksheet = XLSX.utils.json_to_sheet(flatData);
//     XLSX.utils.book_append_sheet(workbook, worksheet, "Invoices");
//   }

//   workbook.Sheets["Invoices"] = worksheet;
//   XLSX.writeFile(workbook, extractedExcelFile);
// }

// // download excel file
// app.get("/download-excel", (req, res) => {
//   if (!fs.existsSync(extractedExcelFile)) {
//     return res.status(404).json({ error: "Excel file not found." });
//   }

//   res.download(extractedExcelFile, "Extracted_Invoices.xlsx", err => {
//     if (err) {
//       console.error("❌ Excel download error:", err.message);
//       res.status(500).json({ error: "Download failed." });
//     }
//   });
// });


// // 🔹 Route: Process One Invoice at a Time
// app.get("/process-one-invoice", async (req, res) => {
//   try {
//     const baseUrl = "http://sja.jagsoftware.in/UserData/Invoices/";
//     const html = await axios.get(baseUrl);
//     const $ = cheerio.load(html.data);

//     const pdfLinks = [];
//     $("a").each((_, el) => {
//       const href = $(el).attr("href");
//       if (href && href.toLowerCase().endsWith(".pdf")) {
//         const fullUrl = new URL(href, baseUrl).href;
//         const fileName = fullUrl.split("/").pop();
//         const localPath = path.join(uploadDir, fileName);
//         if (!fs.existsSync(localPath)) {
//           pdfLinks.push({ fullUrl, fileName });
//         }
//       }
//     });

//     if (pdfLinks.length === 0) {
//       return res.json({ message: "No new PDF files found to download." });
//     }

//     const { fullUrl, fileName } = pdfLinks[0];
//     const localPath = path.join(uploadDir, fileName);
//     console.log(`Downloading: ${fileName}`);

//     const writer = fs.createWriteStream(localPath);
//     const fileRes = await axios({ url: fullUrl, method: "GET", responseType: "stream" });

//     await new Promise((resolve, reject) => {
//       fileRes.data.pipe(writer);
//       writer.on("finish", resolve);
//       writer.on("error", reject);
//     });

//     console.log("Downloaded:", fileName);

//     const result = await analyzeInvoiceWithAzure(localPath);
//     if (!result) throw new Error("Azure training failed");

//     result.file = fileName;
//     saveToExcel([result]);

//     await uploadToFtp(localPath, fileName);
//     fs.unlinkSync(localPath);

//     res.json({
//       status: "done",
//       message: "Processed and uploaded one invoice",
//       extracted: result,
//     });
//   } catch (err) {
//     console.error("❌ Error:", err.message);
//     res.status(500).json({ error: "Processing failed", details: err.message });
//   }
// });

// // 🔹 Start Server
// app.listen(port, () => {
//   console.log(`Server running at http://localhost:${port}`);
// });
