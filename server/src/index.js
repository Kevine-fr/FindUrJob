import 'dotenv/config';
import { createApp } from './app.js';
import { connectDb } from './config/db.js';

const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/filo';

connectDb(MONGO_URI);

const app = createApp();
app.listen(PORT, () => {
  console.log(`✓ API Filo sur http://localhost:${PORT}`);
  console.log(`  Santé : http://localhost:${PORT}/api/health`);
});
