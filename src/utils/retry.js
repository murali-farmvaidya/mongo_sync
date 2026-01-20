const logger = require('./logger');

async function retryWithBackoff(operation, operationName, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      // Don't retry on 4xx errors (except 429 - rate limit)
      if (error.response && error.response.status >= 400 && error.response.status < 500 && error.response.status !== 429) {
        throw error;
      }
      
      if (attempt === maxRetries) {
        logger.error(`${operationName} failed after ${maxRetries} attempts:`, error.message);
        throw error;
      }
      
      const delay = baseDelay * Math.pow(2, attempt - 1);
      const jitter = Math.random() * 1000;
      
      logger.warn(`${operationName} failed (attempt ${attempt}/${maxRetries}). Retrying in ${Math.round((delay + jitter) / 1000)}s...`);
      
      await new Promise(resolve => setTimeout(resolve, delay + jitter));
    }
  }
  
  throw lastError;
}

async function withTimeout(promise, timeoutMs, operationName) {
  let timeoutId;
  
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = {
  retryWithBackoff,
  withTimeout
};