/* eslint-disable */

// const multer = require("multer");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const {db,rtdb}=require("../utils/firebase-config")
const admin=require("firebase-admin")

const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
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
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
      user: "esupplyco3@gmail.com", // 🔹 Replace with your email
      pass: "pmyqbvvfkcxoqlrj",  // 🔹 Replace with your email password or app password
  },
});

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


exports.registerDeliveryBoy = async (req, res) => {
  try {
      const { name, age, adhaar, drivingLicence, phoneNumber, supplycoId ,email} = req.body;

      // ✅ Validate request data
      if (!name || !age || !adhaar || !drivingLicence || !phoneNumber || !supplycoId ||!email) {
          return res.status(400).json({ message: "All fields are required." });
      }

      // ✅ Check if age is greater than or equal to 18
      if (age < 18) {
          return res.status(400).json({ message: "Age must be 18 or above to register." });
      }

      console.log(`📦 New Delivery Boy Registration: ${name}, Phone: ${phoneNumber}, Supplyco: ${supplycoId}`);

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
          email,
          drivingLicence,
          phoneNumber,
          supplycoId, // Added Supplyco ID
          status: "Pending", // Default status: Pending approval
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
      };

      const docRef = await db.collection("deliveryReq").add(newDeliveryBoy);
      logApiCall(`${name} requested at ${supplycoId} for delivery boy`)
      console.log(`✅ Delivery Boy Registered: ${docRef.id}`);
      res.status(201).json({ message: "Registration successful!", deliveryBoyId: docRef.id });

  } catch (error) {
      console.error("❌ Error registering delivery boy:", error);
      res.status(500).json({ error: "Internal server error", details: error.message });
  }
};


//get all delivery reg requests


exports.getDeliveryRequestsBySupplyco = async (req, res) => {
  try {
      const { supplycoId } = req.params;

      // ✅ Validate supplycoId
      if (!supplycoId) {
          return res.status(400).json({ message: "Supplyco ID is required." });
      }

      console.log(`📦 Fetching delivery requests for Supplyco: ${supplycoId}`);

      // ✅ Fetch delivery requests from Firestore where supplycoId matches
      const querySnapshot = await db.collection("deliveryReq")
          .where("supplycoId", "==", supplycoId)
          .get();

      if (querySnapshot.empty) {
          return res.status(404).json({ message: "No delivery requests found for this Supplyco." });
      }

      // ✅ Convert Firestore documents to an array
      const deliveryRequests = querySnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
      }));

      console.log(`✅ Found ${deliveryRequests.length} delivery requests.`);
      res.status(200).json({ deliveryRequests });

  } catch (error) {
      console.error("❌ Error fetching delivery requests:", error);
      res.status(500).json({ error: "Internal server error", details: error.message });
  }
};

// delivery boy status change


exports.updateDeliveryRequestStatus = async (req, res) => {
  try {
      const { requestId } = req.params;
      const { status, staffId } = req.body;

      // ✅ Validate required fields
      if (!requestId || !status || !staffId) {
          return res.status(400).json({ message: "Request ID, status, and staff ID are required." });
      }

      // ✅ Check if status is valid
      if (!["Approved", "Rejected"].includes(status)) {
          return res.status(400).json({ message: "Invalid status. Allowed values: 'Approved', 'Rejected'." });
      }

      console.log(`📦 Updating delivery request ${requestId} to ${status} by Staff: ${staffId}`);

      // ✅ Find the delivery request in Firestore
      const requestRef = db.collection("deliveryReq").doc(requestId);
      const requestDoc = await requestRef.get();

      if (!requestDoc.exists) {
          return res.status(404).json({ message: "Delivery request not found." });
      }

      const requestData = requestDoc.data();

      if (status === "Approved") {
          // ✅ Generate a new delivery boy ID (delivery_001, delivery_002, ...)
          const deliveryBoyRef = db.collection("deliveryBoy");
          const deliveryBoyDocs = await deliveryBoyRef.get();
          const newDeliveryId = `delivery_${String(deliveryBoyDocs.size + 1).padStart(3, "0")}`;

          // ✅ Generate a random password
          const generatedPassword = Math.random().toString(36).slice(-8);

          // ✅ Create user in Firebase Authentication
          const userRecord = await admin.auth().createUser({
              email: requestData.email,
              password: generatedPassword,
              displayName: requestData.name,
              phoneNumber: `+91${requestData.phoneNumber}`, // Ensure correct format
          });

          console.log(`✅ Firebase Auth User Created: ${userRecord.uid}`);

          // ✅ Hash the password before storing in Firestore
          const hashedPassword = await bcrypt.hash(generatedPassword, 10);

          // ✅ Move data to `deliveryBoy` collection
          const newDeliveryBoy = {
              deliveryId: newDeliveryId,
              uid: userRecord.uid, // Store Firebase Auth UID
              name: requestData.name,
              age: requestData.age,
              adhaar: requestData.adhaar,
              drivingLicence: requestData.drivingLicence,
              phoneNumber: requestData.phoneNumber,
              supplycoId: requestData.supplycoId,
              email: requestData.email,
              password: hashedPassword, // Store hashed password
              status: "Active",
              registeredAt: admin.firestore.FieldValue.serverTimestamp(),
          };

          await deliveryBoyRef.doc(newDeliveryId).set(newDeliveryBoy);

          console.log(`✅ Delivery Boy Registered: ${newDeliveryId}`);

          // ✅ Send Email with Credentials
          const mailOptions = {
              from: "your-email@gmail.com", // 🔹 Replace with your email
              to: requestData.email,
              subject: "eSupplyco - Delivery Boy Registration Approved",
              text: `Hello ${requestData.name},\n\nYour registration as a delivery boy has been approved.\n\nYour login credentials:\nUsername: ${requestData.email}\nPassword: ${generatedPassword}\n\nPlease change your password after logging in.\n\nBest Regards,\neSupplyco Team`,
          };

          await transporter.sendMail(mailOptions);
          console.log(`📧 Email sent to ${requestData.email}`);

          // ✅ Remove from `deliveryReq` (optional)
          await requestRef.delete();

          return res.status(200).json({ 
              message: "Delivery request approved, user created, and email sent.", 
              deliveryBoyId: newDeliveryId 
          });

      } else {
          // ✅ If rejected, just update the status
          await requestRef.update({
              status: "Rejected",
              reviewedBy: staffId,
              reviewedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          console.log(`❌ Delivery request ${requestId} rejected.`);
          return res.status(200).json({ message: "Delivery request rejected." });
      }

  } catch (error) {
      console.error("❌ Error updating delivery request status:", error);
      res.status(500).json({ error: "Internal server error", details: error.message });
  }
};