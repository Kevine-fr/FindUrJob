import mongoose from 'mongoose';

// Connexion non bloquante : l'API démarre même si Mongo n'est pas encore prêt,
// et retente en arrière-plan. Pratique en dev / au boot de Docker Compose.
export async function connectDb(uri) {
  mongoose.set('strictQuery', true);
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    console.log('✓ MongoDB connecté');
  } catch (err) {
    console.error('✗ MongoDB indisponible :', err.message);
    console.error('  Nouvelle tentative dans 5 s…');
    setTimeout(() => connectDb(uri), 5000);
  }
}
