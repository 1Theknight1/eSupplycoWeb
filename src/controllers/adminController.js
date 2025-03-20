/* eslint-disable */

const admin=require("firebase-admin")
const {db,rtdb}=require("../utils/firebase-config")
const {authenticateUser}=require("../middlewares/authMiddleware")
const functions = require("firebase-functions");
const fcm = admin.messaging();


//1)Products add
exports.productsAdd = async (req, res) => {
  try {
    const {
      name,
      category,
      unit,
      price,
      discounts,
      quota,
      expiryDate,
      image,
      stock,
      available,
      description
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Product ID and name are required" });
    }

    // 🔥 Get all Supplycos
    const supplycosSnapshot = await db.collection("supplycos").get();
    if (supplycosSnapshot.empty) {
      return res.status(404).json({ error: "No supplycos found" });
    }

    // 🔥 Product Data (Without stock & available)
    const productData = {
      name,
      category,
      unit,
      price,
      discounts,
      quota,
      expiryDate,
      image,
      description,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // 🔄 Loop through each Supplyco and add the product
    const batch = db.batch();
    for (const supplycoDoc of supplycosSnapshot.docs) {
      const supplycoId = supplycoDoc.id;
      const productRef = db.collection("supplycos").doc(supplycoId).collection("products").doc(name);
      batch.set(productRef, productData);

      // 🔥 Update Stock & Availability in RTDB
      const stockUpdateRef = rtdb.ref(`stock_updates/${supplycoId}/${name}`);
      await stockUpdateRef.set({ stock, available });
    }

    await batch.commit(); // Execute Firestore batch writes

    return res.status(201).json({ message: "Product added to all supplycos", name });
  } catch (error) {
    console.error("🔥 Error adding product:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};



  //2).Supplyco Add
  exports.supplycoAdd= authenticateUser, async (req, res) => {
    try {
      const { supplycoId, name,id } = req.body;
  
      if (!supplycoId || !name || !id) {
        return res.status(400).json({ error: "Missing supplycoId or name" });
      }
  
      const supplycoRef = db.collection("supplycoLocations").doc(supplycoId);
      await supplycoRef.set({ name ,id});
  
      return res.status(201).json({ message: "Supplyco added successfully", supplycoId });
    } catch (error) {
      console.error("🔥 Error adding supplyco:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  };
  
  //GET ALL SUPPLYCO
exports.supplycoAll= authenticateUser,async(req,res)=>{
    try {
      const snapshot = await db.collection("supplycoLocations").get();
      
      if (snapshot.empty) {
        return res.status(404).json({ error: "No Supplyco locations found" });
      }
  
      const supplycoList = snapshot.docs.map(doc => ({
        supplycoId: doc.id, 
        name: doc.data().name || "Unnamed Supplyco"
      }));
  
      return res.status(200).json(supplycoList);
    } catch (error) {
      console.error("🔥 Error fetching Supplyco locations:", error);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  };

  //user delete
exports.deleteUser = async (req, res) => {
    const { cardNumber } = req.body; // Get cardNumber from request
  try {
      // ✅ Step 1: Fetch the user document from Firestore
      const userRef = db.collection("users").doc(cardNumber);
      const userDoc = await userRef.get();
  
      if (!userDoc.exists) {
        return res.status(404).json({ message: "User not found in Firestore." });
      }
  
      const userData = userDoc.data();
      const firebaseUid = userData.firebaseUid; // UID from Firestore
  
      // ✅ Step 2: Delete from Firebase Authentication
      if (firebaseUid) {
        await admin.auth().deleteUser(firebaseUid);
        console.log(`✅ Firebase Auth user deleted: ${firebaseUid}`);
      }
  
      // ✅ Step 3: Delete user document from Firestore
      await userRef.delete();
      console.log(`✅ Firestore document deleted for: ${cardNumber}`);
  
      // ✅ Step 4: Respond with success
      res.status(200).json({ message: "User deleted successfully" });
  
    } catch (error) {
      console.error("❌ Error deleting user:", error.message);
      res.status(500).json({ message: "Error deleting user", error: error.message });
    }
  };



  //send message
exports.sendMessage= async (req, res) => {
    const { token, title, body } = req.body;
  
    if (!token || !title || !body) {
      return res.status(400).send({ error: "Missing token, title, or body" });
    }
  
    const message = {
      notification: {
        title: title,
        body: body,
      },
      token: token,
    };
  
    try {
      const response = await admin.messaging().send(message);
      console.log("✅ Notification sent:", response);
      res.status(200).send({ success: true, response });
    } catch (error) {
      console.error("❌ Error sending notification:", error);
      res.status(400).send({ success: false, error });
    }
  };



  //send message when slots are available

exports.setReminder = functions.https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }
  
    try {
      const { cardNumber, slotId, supplycoId, date } = req.body;
  
      if (!cardNumber || !slotId || !supplycoId || !date) {
        return res.status(400).send('cardNumber, SlotId, SupplycoId, and Date are required');
      }
  
      // Fetch the slot from the supplyco document
      const slotRef = db.collection('supplycos')
                             .doc(supplycoId)
                             .collection('slots')
                             .doc(slotId); 
  
      const slotDoc = await slotRef.get();
  
      if (!slotDoc.exists) {
        return res.status(404).send('Slot not found');
      }
  
      const slotData = slotDoc.data();
  
      // Check if the slot is available, send notification if it is available
      if (slotData.status === 'available') {
        // Send immediate notification since the slot is available
        await sendNotification(cardNumber, slotId);
        return res.status(200).send('Reminder set, slot is available now.');
      }
  
      // Now, store the reminder in Firestore under the 'date' document for the supplyco
      const reminderRef = db.collection('supplycos')
                                    .doc(supplycoId)
                                    .collection('reminders')
                                    .doc(date); // Store reminder for the specific date
      
      const reminderDoc = await reminderRef.get();
      
      if (!reminderDoc.exists) {
        // If the date document doesn't exist, create a new one with the slot and the user
        await reminderRef.set({
          [slotId]: {
            users: [cardNumber],
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          }
        });
      } else {
        // If the date document exists, update the slot to add the user to the list of users
        await reminderRef.update({
          [`${slotId}.users`]: admin.firestore.FieldValue.arrayUnion(cardNumber),
        });
      }
  
      res.status(200).send('Reminder set successfully');
    } catch (error) {
      console.error('Error setting reminder:', error);
      res.status(500).send('Internal Server Error');
    }
  });
  
  // Function to send notification to user
  async function sendNotification(cardNumber, slotId) {
    try {
      const userDoc = await admin.firestore().collection('users').doc(cardNumber).get();
      if (!userDoc.exists) {
        throw new Error('User not found');
      }
  
      const userToken = userDoc.data().fcmToken;
  
      if (!userToken) {
        throw new Error('FCM Token not found for user');
      }
  
      const message = {
        notification: {
          title: 'Slot Available!',
          body: `The slot you were interested in is now available.`,
        },
        token: userToken,
      };
  
      const response = await admin.messaging().send(message);
      console.log('Notification sent successfully:', response); // Log the response from FCM
    } catch (error) {
      console.error('Error sending notification:', error);
      // More detailed error logging
      if (error.response) {
        console.error('FCM Error Response:', error.response);
      }
    }
  }


  //add quota monthly
  exports.setQuota= async (req, res) => {
    try {
      const { monthYear, products } = req.body;
  
      // Input validation
      if (!monthYear || !products || !Array.isArray(products)) {
        return res.status(400).json({ message: "Invalid request format." });
      }
  
      // Validate products array
      for (const product of products) {
        if (!product.name || !product.quota) {
          return res.status(400).json({ message: "Invalid product format." });
        }
        // if (!product.quota.APL || !product.quota.BPL) {
        //   return res.status(400).json({ message: "Quota must be specified for all card types (APL, BPL)." });
        // }
      }
  
      // Save quota details to Firestore
      const quotaRef = db.collection('monthlyQuotas').doc(monthYear);
      await quotaRef.set({
        monthYear,
        products
      });
  
      // Return success response
      res.status(200).json({
        message: `Quota set successfully for ${monthYear}`,
        data: {
          monthYear,
          products
        }
      });
  
    } catch (error) {
      console.error("❌ Error setting quota:", error.message, error.stack);
      res.status(500).json({ error: "Internal server error", details: error.message });
    }
  };
  
  //get staff requests
  exports.staffRequests= async (req, res) => {
    try {
      const staffRequestsRef = db.collection("staffRequest");
      const snapshot = await staffRequestsRef.get();
  
      if (snapshot.empty) {
        return res.status(404).json({ message: "No staff requests found." });
      }
  
      const staffRequests = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
      }));
  
      res.status(200).json(staffRequests);
    } catch (error) {
      console.error("Error fetching staff requests:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  };