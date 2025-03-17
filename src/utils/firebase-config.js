/* eslint-disable */
require('dotenv').config();
const admin = require('firebase-admin');
let serviceAccount;

try {
    if (process.env.FIREBASE_CREDENTIALS) {
        const decodedKey = Buffer.from(process.env.FIREBASE_CREDENTIALS, 'base64').toString('utf8');
        serviceAccount = JSON.parse(decodedKey);
    } else {
        serviceAccount = require("../../key.json"); // Fallback for local development
    }
} catch (error) {
    console.error("❌ Error parsing Firebase credentials:", error.message);
    process.exit(1); // Exit the app if credentials are invalid
}


admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL:process.env.DATABASE_URL , 
  storageBucket: process.env.STORAGE_BUCKET,
});
console.log(process.env.DATABASE_URL)

const db = admin.firestore();
const rtdb = admin.database(); 
module.exports = { db, rtdb };