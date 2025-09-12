//queues/invoiceRetryQueue
const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const connection = new IORedis();

const invoiceRetryQueue = new Queue('invoiceRetry', { connection });

module.exports = { invoiceRetryQueue, connection };
