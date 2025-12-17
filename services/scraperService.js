// // services/scraperService
// const axios = require("axios");
// const cheerio = require("cheerio");
// const path = require("path");
// const { uploadDir } = require("../config/constants");

// exports.scrapePdfLinks = async () => {
//   const baseUrl = process.env.INVOICE_BASE_URL;

//   if (!baseUrl) throw new Error("INVOICE_BASE_URL is not");

//   const html = await axios.get(baseUrl);
//   const $ = cheerio.load(html.data);

//   const pdfLinks = [];

//   $("a").each((_, el) => {
//     const href = $(el).attr("href");
//     if (href && href.toLowerCase().endsWith(".pdf")) {
//       const fullUrl = new URL(href, baseUrl).href;
//       const fileName = fullUrl.split("/").pop();
//       const localPath = path.join(uploadDir, fileName);
//       pdfLinks.push({ fullUrl, fileName, localPath });
//     }
//   });
//   console.log("All detected PDF links:", pdfLinks);


//   return pdfLinks;
// };
