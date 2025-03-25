/* eslint-disable */

// const multer = require("multer");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const {db,rtdb}=require("../utils/firebase-config")
const admin=require("firebase-admin")
// const upload = multer({ dest: "uploads/" });
// const storage = multer.memoryStorage(); // Store files in memory before uploading to Firebase
const bucket = admin.storage().bucket();

async function logApiCall(action) {
  const logRef = db.collection("logs").doc();
  await logRef.set({
    action: action, // Custom action description
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log("saved staff log");
}

//get orders of supplyco
exports.getSupplycoOrders= async (req, res) => {
    try {
      const { supplycoId } = req.params;
      const snapshot = await db.collection("orders").where("supplycoId", "==", supplycoId).get();
      const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      res.status(200).json(orders);
    } catch (error) {
      res.status(500).json({ error: "Error fetching orders", details: error.message });
    }
  };


  //staff regsiter

  exports.staffRegister = async (req, res) => {
    try {
      // Parse form data from the request
      upload.fields([
        { name: "businessCertificate", maxCount: 1 },
        { name: "govtID", maxCount: 1 },
        { name: "taxProof", maxCount: 1 },
      ])(req, res, async (err) => {
        if (err) {
          console.error("File upload error:", err);
          return res.status(400).json({ error: "File upload error. Please check the file types and sizes." });
        }
  
        const {
          supplycoName,
          owner,
          contact,
          email,
          address,
          taluk,
          city,
          latitude,
          longitude,
          deliveryAvailable,
          taxIdNumber,
        } = req.body;
  
        // Validate required fields
        if (
          !supplycoName ||
          !owner ||
          !contact ||
          !email ||
          !address ||
          !taluk ||
          !city ||
          !latitude ||
          !longitude ||
          !taxIdNumber ||
          deliveryAvailable === undefined
        ) {
          return res.status(400).json({ error: "All fields are required." });
        }
  
        // Function to upload a file to Firebase Storage and return the URL
        const uploadFile = async (file, folderName) => {
          if (!file || !file.buffer) return null; // Check for file buffer
          const fileName = `${folderName}/${uuidv4()}_${file.originalname}`;
          const fileUpload = bucket.file(fileName);
  
          await fileUpload.save(file.buffer, {
            contentType: file.mimetype,
            metadata: { firebaseStorageDownloadTokens: uuidv4() },
          });
  
          return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
            fileName
          )}?alt=media`;
        };
  
        // Upload files to Firebase Storage
        const businessCertURL = await uploadFile(req.files.businessCertificate?.[0], "business_certificates");
        const govtIDURL = await uploadFile(req.files.govtID?.[0], "govt_ids");
        const taxProofURL = await uploadFile(req.files.taxProof?.[0], "tax_proofs");
  
        // Save data to Firestore (`staffRequest` collection)
        const newStaffRef = db.collection("staffRequest").doc();
        await newStaffRef.set({
          supplycoName,
          owner,
          contact,
          email,
          address,
          taluk,
          city,
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          taxIdNumber,
          deliveryAvailable: deliveryAvailable === "true", // Convert to boolean
          businessCertificate: businessCertURL,
          govtID: govtIDURL,
          taxProof: taxProofURL,
          status: "pending", // Mark as pending by default
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await logApiCall(`${owner} is requested for eSupplyco staff` );
        res.status(201).json({
          message: "Staff registration request submitted successfully!",
          requestId: newStaffRef.id, // Include the Firestore document ID
        });
      });
    } catch (error) {
      console.error("Error registering staff:", error);
      res.status(500).json({ error: "Internal Server Error", details: error.message });
    }
  };


  //login
  const SECRET_KEY = 'bG7xY89aPqR2kD6uKmN3vFxTYd2/ZGhl'; // Change this to a secure key

  exports.staffLogin= async (req, res) => {
    const { supplycoId, username, password } = req.body;
  
    if (!supplycoId || !username || !password) {
      return res.status(400).json({ error: "Missing required fields" });
    }
  
    try {
      const staffDoc = await db.collection("staff-auth").doc(supplycoId).get();
      if (!staffDoc.exists) {
        return res.status(404).json({ error: "Supplyco not found" });
      }
  
      const staffData = staffDoc.data();
      
      if (staffData.username !== username || staffData.password !== password) {
        return res.status(401).json({ error: "Invalid username or password" });
      }
  
      // Generate JWT token
      const token = jwt.sign({ supplycoId, username }, SECRET_KEY, {
        expiresIn: "1h",
      });
  
      return res.json({ message: "Login successful", token });
    } catch (error) {
      return res.status(500).json({ error: "Internal Server Error", details: error.message });
    }
  };


  //slot add
  const generateSlotId = async (supplycoId) => {
    const slotsRef = db.collection("supplycos").doc(supplycoId).collection("slots");
    const snapshot = await slotsRef.get();

    let maxSlotNumber = 0;

    snapshot.forEach((doc) => {
        const slotId = doc.id; // Example: slot_03
        const match = slotId.match(/slot_(\d+)/);
        if (match) {
            const slotNumber = parseInt(match[1], 10);
            if (slotNumber > maxSlotNumber) {
                maxSlotNumber = slotNumber;
            }
        }
    });

    return `slot_${(maxSlotNumber + 1).toString().padStart(2, "0")}`;
};

// API to add a walk-in slot
exports.addSlot= async (req, res) => {
    try {
        const { supplycoId } = req.params;
        const { start_time, end_time, capacity, booked_count = 0, status = "available" } = req.body;

        if (!start_time || !end_time || !capacity) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        // Generate new slot ID
        const newSlotId = await generateSlotId(supplycoId);

        // Slot data
        const slotData = {
            start_time,
            end_time,
            capacity,
            booked_count,
            status,
        };

        // Add slot to Firestore
        await db.collection("supplycos").doc(supplycoId).collection("slots").doc(newSlotId).set(slotData);
        await logApiCall(`New walkin-Slot :${newSlotId} added at ${supplycoId}` );
        return res.status(201).json({ message: "Walk-in slot added successfully", slotId: newSlotId });
    } catch (error) {
        console.error("Error adding walk-in slot:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

//walkin all slots for supplyco
exports.getAllSlotsForSUpplyco= async (req, res) => {
  try {
    const { supplycoId } = req.params;

    // Reference to the 'bookings' subcollection
    const bookingsRef = db.collection("supplycos").doc(supplycoId).collection("bookings");
    const bookingsSnapshot = await bookingsRef.get();

    if (bookingsSnapshot.empty) {
      return res.status(404).json({ message: "No bookings found." });
    }

    // Extract all dates and slot details
    const bookingsData = {};
    bookingsSnapshot.forEach((doc) => {
      bookingsData[doc.id] = doc.data(); // doc.id is the date
    });

    return res.status(200).json({ supplycoId, bookings: bookingsData });

  } catch (error) {
    console.error("Error fetching booking data:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};


//get supplyco details for profile
exports.getSupplycoDetails= async (req, res) => {
  try {
      const { supplycoId } = req.params;

      // Fetch the supplyco document from Firestore
      const supplycoRef = db.collection("supplycos").doc(supplycoId);
      const doc = await supplycoRef.get();

      if (!doc.exists) {
          return res.status(404).json({ success: false, message: "Supplyco not found" });
      }

      const supplycoData = doc.data();
      return res.status(200).json({ success: true, data: supplycoData });

  } catch (error) {
      console.error("Error fetching Supplyco details:", error);
      return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

//check if user booked a slot
exports.getSlotByCardNumber= async (req, res) => {
  try {
    const { cardNumber } = req.body;

    if (!cardNumber) {
      return res.status(400).json({ error: "Card number is required" });
    }

    const supplycosSnapshot = await db.collection("supplycos").get();
    let result = [];

    for (const supplycoDoc of supplycosSnapshot.docs) {
      const supplycoId = supplycoDoc.id;
      const bookingsRef = supplycoDoc.ref.collection("bookings");
      const bookingDatesSnapshot = await bookingsRef.get();

      for (const dateDoc of bookingDatesSnapshot.docs) {
        const date = dateDoc.id;
        const slotsData = dateDoc.data();

        for (const [slotId, slotInfo] of Object.entries(slotsData)) {
          if (slotInfo.users && Array.isArray(slotInfo.users)) {
            const user = slotInfo.users.find(
              (u) =>
                (typeof u === "object" && u.cardNumber === cardNumber) ||
                u === cardNumber
            );
            if (user) {
              result.push({
                supplycoId,
                slotId,
                date,
                success: true,
                message: "Slot found successfully",
              });
            }
          }
        }
      }
    }

    if (result.length > 0) {
      return res.status(200).json(result);
    } else {
      return res.status(404).json({ error: "No slots found for this card number" });
    }
  } catch (error) {
    console.error("Error fetching slot:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};


//verify pickup slot
exports.checkPickup= async (req, res) => {
  const { orderId } = req.body;

  if (!orderId) {
    return res.status(400).json({ error: "Missing orderId in request body." });
  }

  try {
    const orderRef = db.collection("orders").doc(orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      return res.status(404).json({ error: "Order not found." });
    }

    const orderData = orderDoc.data();

    // Check if orderType is "pickup"
    if (orderData.orderType !== "Pickup") {
      return res.status(400).json({ error: "This order is not a pickup order." });
    }

    // Check if order is already collected
    if (orderData.status === "Collected") {
      return res.status(400).json({ error: "Order is already collected." });
    }

    // Update order status to "collected"
    await orderRef.update({ status: "Collected" });
    await logApiCall(` Order:${orderId} was successfully collected` );
    return res.status(200).json({ success: true, message: "Order status updated to collected." });

  } catch (error) {
    console.error("Error checking order:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
};


//update stock
exports.updateStock= async (req, res) => {
  try {
    const { supplycoId, productName, newStock } = req.body;

    if (!supplycoId || !productName || newStock === undefined) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const stockRef = rtdb.ref(`stock_updates/${supplycoId}/${productName}`);

    // Update stock in Realtime Database
    await stockRef.set({
      stock: newStock,
      
    });

    res.json({ success: true, message: "Stock updated successfully" });
  } catch (error) {
    console.error("Error updating stock:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

//register deliveryboy

const admin = require("firebase-admin");
const db = admin.firestore();

exports.registerDeliveryBoy = async (req, res) => {
    try {
        const { name, age, adhaar, drivingLicence, phoneNumber } = req.body;

        // ✅ Validate request data
        if (!name || !age || !adhaar || !drivingLicence || !phoneNumber) {
            return res.status(400).json({ message: "All fields are required." });
        }

        // ✅ Check if age is greater than or equal to 18
        if (age < 18) {
            return res.status(400).json({ message: "Age must be 18 or above to register." });
        }

        console.log(`📦 New Delivery Boy Registration: ${name}, Phone: ${phoneNumber}`);

        // ✅ Check if the delivery boy is already registered
        const existingQuery = await db.collection("deliveryReq")
            .where("phoneNumber", "==", phoneNumber)
            .get();

        if (!existingQuery.empty) {
            return res.status(400).json({ message: "Phone number already registered." });
        }

        // ✅ Store in Firestore (deliveryReq collection)
        const newDeliveryBoy = {
            name,
            age,
            adhaar,
            drivingLicence,
            phoneNumber,
            status: "Pending", // Default status: Pending approval
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        };

        const docRef = await db.collection("deliveryReq").add(newDeliveryBoy);

        console.log(`✅ Delivery Boy Registered: ${docRef.id}`);
        res.status(201).json({ message: "Registration successful!", deliveryBoyId: docRef.id });

    } catch (error) {
        console.error("❌ Error registering delivery boy:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};

//get all delivery reg requests


exports.getPendingDeliveryRequests = async (req, res) => {
    try {
        console.log("📦 Fetching all pending delivery requests...");

        // ✅ Query Firestore for documents with status "Pending"
        const querySnapshot = await db.collection("deliveryReq")
            .where("status", "==", "Pending")
            .get();

        // ✅ If no pending requests found
        if (querySnapshot.empty) {
            return res.status(404).json({ message: "No pending delivery requests found." });
        }

        // ✅ Extract data from Firestore documents
        const pendingRequests = querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        console.log(`✅ Found ${pendingRequests.length} pending delivery requests.`);
        res.status(200).json({ pendingRequests });

    } catch (error) {
        console.error("❌ Error fetching pending delivery requests:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};



