/* eslint-disable */

const admin = require("firebase-admin");

// ✅ Middleware: Verify Firebase Token & Extract cardNumber
exports.authenticateUser = async (req, res, next) => {
  try {
    const idToken = req.headers.authorization?.split("Bearer ")[1];

    if (!idToken) {
      return res.status(401).json({ message: "Unauthorized: No token provided" });
    }

    // ✅ Verify token and extract claims
    const decodedToken = await admin.auth().verifyIdToken(idToken, true); // Force token refresh
    console.log("🔑 Decoded Token:", decodedToken);

    // ✅ Fetch user details to get custom claims
    const user = await admin.auth().getUser(decodedToken.uid);
    const claims = user.customClaims || {};

    if (!claims.cardNumber) {
      console.log("⛔ No cardNumber claim found!");
      return res.status(403).json({ message: "Forbidden: No cardNumber claim" });
    }

    req.cardNumber = claims.cardNumber;
    console.log(`🔐 Authenticated User: ${req.cardNumber}`);
    next();
  } catch (error) {
    console.error("❌ Authentication error:", error.message);
    return res.status(401).json({ message: "Unauthorized: Invalid token" });
  }
};


exports.setCardNumberClaim = async (uid, cardNumber) => {
  try {
    // ✅ Set Custom Claims (Attach cardNumber to Firebase Token)
    await admin.auth().setCustomUserClaims(uid, { cardNumber });

    console.log(`✅ Custom claim set: cardNumber = ${cardNumber} for user ${uid}`);
    return uid;
  } catch (error) {
    console.error("❌ Error setting custom claims:", error.message);
    throw new Error("Failed to set cardNumber in authentication.");
  }
};