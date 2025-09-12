//services/azureService
const fs = require("fs");
const axios = require("axios");
const path = require("path");

function getModelIdFromFile(filePath) {
  const name = path.basename(filePath).toLowerCase();
  return "invoice_model_id"; 
}

async function callAzureWithRetry(fileData, apiUrl, headers) {
  let attempt = 1;
  while (true) {  
    try {
      const res = await axios.post(apiUrl, fileData, { headers });
      return res;  
    } catch (err) {
      console.warn(`Azure POST attempt ${attempt} failed, retrying...`);
      attempt++;

      if (attempt > 10) { 
        console.error(`Azure POST failed after 10 attempts`);
        throw err;
      }
      await new Promise((r) => setTimeout(r, 1000));  
    }
  }
}

async function analyzeInvoiceWithAzure(filePath) {
  const modelId = getModelIdFromFile(filePath);
  const apiUrl = `${process.env.AZURE_ENDPOINT}/formrecognizer/documentModels/${modelId}:analyze?api-version=2023-07-31`;

  console.log(`Analyzing file: ${filePath}`);
  console.log(`Using Azure model ID: ${modelId}`);

  const fileData = fs.readFileSync(filePath);
  const headers = {
    "Content-Type": "application/pdf",
    "Ocp-Apim-Subscription-Key": process.env.AZURE_KEY,
  };

  try {
    const postResponse = await callAzureWithRetry(fileData, apiUrl, headers); 

    const operationLocation = postResponse.headers["operation-location"];
    if (!operationLocation) {
      throw new Error("Azure response missing operation-location header");
    }

    let result = null;
    let tries = 0;

    while (true) { 
      await new Promise((r) => setTimeout(r, 3000));  

      try {
        const statusResponse = await axios.get(operationLocation, {
          headers: { "Ocp-Apim-Subscription-Key": process.env.AZURE_KEY },
        });

        const status = statusResponse.data.status;

        if (status === "succeeded") {
          result = statusResponse.data.analyzeResult;
          break;  // If succeeded, exit the loop
        } else if (status === "failed") {
          console.warn(`Invoice processing failed, retrying...`);
        } else {
          console.log(`⏳ Azure analysis status: ${status} (Attempt ${tries + 1})`);
        }
      } catch (err) {
        console.warn(`Error checking Azure status: ${err.message}, retrying...`);
      }

      tries++;
    }

    console.log("✅ Azure analysis succeeded");
    return {
      file: path.basename(filePath),
      full_json: result,
    };

  } catch (err) {
    console.error("Azure analysis error:", err.message);
    return null;
  }
}


module.exports = { analyzeInvoiceWithAzure };
