/* eslint-disable */

const admin = require("firebase-admin");
const { setCardNumberClaim } = require("../middlewares/authMiddleware");
const { db } = require("../utils/firebase-config");

// 1️⃣ ✅ REGISTER USER
exports.registerUser = async (req, res) => {
  const { cardNumber, phoneNumber } = req.body;

  try {
    // ✅ Step 1: Check if the user already exists in Firestore
    const userRef = db.collection("users").doc(cardNumber);
    const userDoc = await userRef.get();

    if (userDoc.exists) {
      return res.status(400).json({ message: "User already registered." });
    }

    // ✅ Step 2: Fetch Ration Card Holder Data
    const rationCardHolderRef = db.collection("rationCardHolder").doc(cardNumber);
    const rationCardHolderDoc = await rationCardHolderRef.get();

    if (!rationCardHolderDoc.exists) {
      return res.status(404).json({ message: "Ration card holder not found" });
    }

    const userData = rationCardHolderDoc.data();

    // ✅ Step 3: Create Firebase Auth User
    let uid;
    try {
      const userRecord = await admin.auth().getUserByPhoneNumber(phoneNumber);
      uid = userRecord.uid;
    } catch (error) {
      if (error.code === "auth/user-not-found") {
        const newUser = await admin.auth().createUser({
          phoneNumber: phoneNumber,
          displayName: userData.name,
        });
        uid = newUser.uid;
      } else {
        throw error;
      }
    }
    const currentTime = new Date(); // 🔥 Get the current system time
        const todayDateString = currentTime.toISOString().split("T")[0];

    // ✅ Step 4: Store User in "users" Collection
    await userRef.set({
      firebaseUid: uid,
      cardNumber,
      name: userData.name,
      email: userData.email || "",
      address: userData.address || "",
      familySize: userData.familySize || 0,
      houseNumber: userData.houseNumber || "",
      panchayat: userData.panchayat || "",
      photo: userData.photo || "",
      taluk: userData.taluk || "",
      wardNumber: userData.wardNumber || "",
      rationType: userData.rationType || "",
      annualIncome: userData.annualIncome || 0,
      phoneNumber: phoneNumber,
      lastLogged: todayDateString,
    });

    // ✅ Step 5: Set Firebase Authentication Custom Claims
    await setCardNumberClaim(uid, cardNumber);

    // ✅ Step 6: Generate Firebase Custom Token
    const customToken = await admin.auth().createCustomToken(uid);

    // ✅ Step 7: Respond with Success
    res.status(200).json({
      message: "User successfully registered",
      token: customToken,
      data: cardNumber,
    });

  } catch (error) {
    console.error("Error registering user:", error.message);
    res.status(500).json({ message: "Error registering user", error: error.message });
  }
};



// 2️⃣ ✅ LOGIN USER
exports.userLogin = async (req, res) => {
  const { cardNumber } = req.body;

  try {
    // ✅ Step 1: Fetch User Data from Firestore
    const userRef = db.collection("users").doc(cardNumber);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ message: "User not found" });
    }

    const userData = userDoc.data();

    // ✅ Step 2: Fetch Firebase Authentication User
    let userRecord;
    try {
      // Fetch user by UID stored in Firestore
      userRecord = await admin.auth().getUser(userData.firebaseUid);
    } catch (error) {
      if (error.code === "auth/user-not-found") {
        console.error("No Auth User Found for:", cardNumber);
        return res.status(404).json({ message: "User authentication not set up. Try registering again." });
      } else {
        throw error;
      }
    }

    // ✅ Step 3: Generate Firebase Custom Token
    const customToken = await admin.auth().createCustomToken(userRecord.uid);

    // ✅ Step 4: Update Last Logged Time
    const currentTime = new Date(); // 🔥 Get the current system time
        const todayDateString = currentTime.toISOString().split("T")[0];
    await userRef.update({ lastLogged: todayDateString });

    // ✅ Step 5: Respond with Success
    res.status(200).json({
      message: "Login successful",
      token: customToken,
      data: cardNumber,
    });

  } catch (error) {
    console.error("Error logging in:", error.message);
    res.status(500).json({ message: "Error logging in", error: error.message });
  }
};