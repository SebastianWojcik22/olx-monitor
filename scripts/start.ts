import 'dotenv/config';
import { startServer } from '../src/server.js';
import { startScheduler } from '../src/scheduler.js';

const PORT = Number(process.env.PORT ?? 3001);

startServer(PORT);
startScheduler();
