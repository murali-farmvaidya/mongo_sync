# Pipecat MongoDB Realtime Sync

This service synchronizes Pipecat conversation data into MongoDB in real-time. It prioritizes clean "Conversation" extraction (User Q & Assistant A) over raw logs.

## Setup & Run

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Run Sync Service**:
   ```bash
   npm run sync
   ```
   *This executes `scripts/sync-realtime.js`. It runs continuously every 60 seconds.*

## Features

- **Real-time Sync**: Polls for new data every 60 seconds.
- **Clean Conversations**: Parses raw logs to extract nice Q&A pairs (removing system prompts and "thinking" context).
- **Date Filtering**: Only syncs data from **January 1, 2026** onwards.
- **Optimized**: Stops fetching logs once it reaches old data to save API calls.
- **Robust Parser**: Handles single/double quotes and mixed content in logs reliably.
- **No Raw Logs**: Does NOT store the massive/messy `logs` collection. Stores `conversations`, `sessions`, and `agents`.

## Project Structure & File Descriptions

### Core Script
- **`scripts/sync-realtime.js`**: **THE MAIN SCRIPT**. Contains the entire logic for connecting to MongoDB, fetching Pipecat data, parsing conversations, and loop scheduling. It uses the `PipecatClient` from `src/config`.

### Configuration & Utils
- **`src/config/pipecat.js`**: The `PipecatClient` class. Handles all HTTP requests to the Pipecat API (fetching agents, sessions, logs).
- **`src/utils/logger.js`**: Logging utility (using Winston). Configured to output to Console only (file logging disabled).
- **`package.json`**: Project dependencies and scripts.

### Legacy / Support Files (in `src/`)
*These files are part of the original project structure but are largely bypassed or disabled in favor of `sync-realtime.js`.*
- **`src/index.js`**: Legacy entry point. Starts the application but the internal cron job has been disabled.
- **`src/jobs/sync.job.js`**: The old sync job. **Currently Disabled** to prevent conflicts with the realtime script.
- **`src/config/cron.js`**: Legacy cron scheduler configuration.
- **`src/services/agent.service.js`**: Helper helper methods for agent data (used by legacy job).
- **`src/services/session.service.js`**: Helper methods for session data (used by legacy job).
- **`src/services/log.service.js`**: Helper methods for log data (used by legacy job).