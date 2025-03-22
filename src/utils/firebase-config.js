/* eslint-disable */
require('dotenv').config();
const admin = require('firebase-admin');
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);


admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL:"https://esupplyco-5f640-default-rtdb.asia-southeast1.firebasedatabase.app" , 
  storageBucket: "esupplyco-5f640.firebasestorage.app",
});
console.log(process.env.DATABASE_URL)

const db = admin.firestore();
const rtdb = admin.database(); 
const auth = admin.auth(); 
module.exports = { db, rtdb ,auth};