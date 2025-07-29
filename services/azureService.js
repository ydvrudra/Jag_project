const fs = require("fs");
const axios = require("axios");
const path = require("path");

async function analyzeInvoiceWithAzure(filePath) {
  const apiUrl = `${process.env.AZURE_ENDPOINT}/formrecognizer/documentModels/prebuilt-invoice:analyze?api-version=2023-07-31`;
  const fileData = fs.readFileSync(filePath);

  try {
    const res = await axios.post(apiUrl, fileData, {
      headers: {
        "Content-Type": "application/pdf",
        "Ocp-Apim-Subscription-Key": process.env.AZURE_KEY,
      },
    });

    const operationLocation = res.headers["operation-location"];
    let result;
    let tries = 0;
    while (tries < 10) {
      await new Promise((r) => setTimeout(r, 3000));
      const statusRes = await axios.get(operationLocation, {
        headers: { "Ocp-Apim-Subscription-Key": process.env.AZURE_KEY },
      });

      if (statusRes.data.status === "succeeded") {
        result = statusRes.data.analyzeResult;
        break;
      }
      tries++;
    }

    if (!result) throw new Error("Azure invoice analysis failed or timed out");

    return {
      file: path.basename(filePath),
      full_json: result,
    };
  } catch (err) {
    console.error("❌ Azure analysis error:", err.message);
    return null;
  }
}

module.exports = { analyzeInvoiceWithAzure };
