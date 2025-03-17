/* eslint-disable */
require('dotenv').config();
const admin = require('firebase-admin');
const serviceAccount = require('../../key.json');


admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL:process.env.DATABASE_URL , 
  storageBucket: process.env.STORAGE_BUCKET,
});
console.log(process.env.DATABASE_URL)

const db = admin.firestore();
const rtdb = admin.database(); 
module.exports = { db, rtdb };