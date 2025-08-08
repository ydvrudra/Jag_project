const fs = require("fs");
const axios = require("axios");
const path = require("path");

// Get modelId dynamically
function getModelIdFromFile(filePath) {
  const name = path.basename(filePath).toLowerCase();
  //if (name.includes("v2")) return "invoice-model-rudra-v2";
  //if (name.includes("v3")) return "invoice-model-rudra-v3";
 // if (name.includes("v4")) return "invoice-model-rudra-v4";
  return "new_invoice_model_id"; 
}

// Retry wrapper
async function callAzureWithRetry(fileData, apiUrl, headers, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await axios.post(apiUrl, fileData, { headers });
      return res;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      console.warn(` Azure POST failed on attempt ${attempt}, retrying...`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

async function analyzeInvoiceWithAzure(filePath) {
  const modelId = getModelIdFromFile(filePath);
  const apiUrl = `${process.env.AZURE_ENDPOINT}/formrecognizer/documentModels/${modelId}:analyze?api-version=2023-07-31`;



  console.log("📄 FilePath:", filePath);
  console.log("🔍 Using modelId:", modelId);
  console.log("🔗 API URL:", apiUrl);
  

  const fileData = fs.readFileSync(filePath);
  const headers = {
    "Content-Type": "application/pdf",
    "Ocp-Apim-Subscription-Key": process.env.AZURE_KEY,
  };

  try {
    const res = await callAzureWithRetry(fileData, apiUrl, headers);

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
    console.error(" Azure analysis error:", err.message);
    return null;
  }
}



module.exports = { analyzeInvoiceWithAzure };

