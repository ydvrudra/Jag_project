// workers/invoiceRetryWorker.js
const { Worker } = require('bullmq');
const { invoiceRetryQueue, connection } = require('../queues/invoiceRetryQueue');
const { processInvoice } = require('../services/invoiceProcessor');

const worker = new Worker('invoiceRetry', async job => {
  const { fullUrl, fileName, localPath, attempt } = job.data;

  console.log(`🔄 Retrying invoice ${fileName}, attempt ${attempt}`);

  const result = await processInvoice(fullUrl, fileName, localPath);

  if (!result.success) {
    if (attempt >= 5) {  
      console.error(`❌ Invoice ${fileName} failed after ${attempt} retries, marking permanently failed.`);
      return;
    }
    await invoiceRetryQueue.add('retry', {
      ...job.data,
      attempt: attempt + 1
    }, { delay: 60000 }); // retry after 1 min
  } else {
    console.log(`✅ Invoice ${fileName} processed successfully on retry attempt ${attempt}`);
  }
}, { connection });

worker.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed: ${err.message}`);
});
