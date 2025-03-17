/* eslint-disable */

// const multer = require("multer");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const {db,rtdb}=require("../utils/firebase-config")
const admin=require("firebase-admin")
// const upload = multer({ dest: "uploads/" });
// const storage = multer.memoryStorage(); // Store files in memory before uploading to Firebase
const bucket = admin.storage().bucket();

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