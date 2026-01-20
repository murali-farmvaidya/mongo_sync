# Pipecat MongoDB Sync Service

A production-ready backend service that continuously syncs data from Pipecat Cloud into MongoDB.

## Features

- ✅ Automatic hourly sync of Agents, Sessions, and Logs
- ✅ Idempotent operations (no duplicates)
- ✅ Retry logic with exponential backoff
- ✅ Graceful error handling
- ✅ Comprehensive logging
- ✅ Manual sync capability
- ✅ Configurable via environment variables

## Quick Start

### 1. Installation

```bash
# Clone repository
git clone <repository-url>
cd pipecat-mongodb-sync

# Install dependencies
npm install