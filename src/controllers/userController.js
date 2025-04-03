/* eslint-disable */

const {db,admin}=require("../utils/firebase-config")
//const admin=require("firebase-admin")

//1)Get phone number
exports.getPhoneNumber= async (req, res) => {
    try {
      const { cardNumber } = req.body; // ✅ Now expects cardNumber from request body
  
      if (!cardNumber) {
        return res.status(400).json({ message: "Missing cardNumber in request body" });
      }
  
      const rationCardHolderRef = db.collection('rationCardHolder').doc(cardNumber);
      const rationCardHolderDoc = await rationCardHolderRef.get();
  
      if (!rationCardHolderDoc.exists) {
        return res.status(404).json({ message: 'Ration card holder not found' });
      }
  
      const phoneNumber = rationCardHolderDoc.data().phoneNumber;
      res.status(200).json({ phoneNumber });
  
    } catch (error) {
      console.error('❌ Error fetching phone number:', error.message);
      res.status(500).json({ message: 'Error fetching phone number', error: error.message });
    }
  };

  //2)Get user info
  exports.getUserInfo=  async (req, res) => {
    try {
      res.status(200).json({ message: "User authenticated!", cardNumber: req.cardNumber });
    } catch (error) {
      res.status(500).json({ message: "Error fetching user info", error: error.message });
    }
  };
  

  //get all supplyco locations
  exports.getAllSupplycos = async (req, res) => {
    try {
        const supplycosSnapshot = await db.collection("supplycos").get();
  
        if (supplycosSnapshot.empty) {
            return res.status(404).json({ message: "No supplycos found" });
        }
  
        let supplycos = [];
        supplycosSnapshot.forEach(doc => {
            supplycos.push({ id: doc.id, ...doc.data() });
        });
  
        return res.status(200).json({ supplycos });
    } catch (error) {
        console.error("❌ Error fetching supplycos:", error);
        return res.status(500).json({ error: "Internal server error", details: error.message });
    }
  };
  

  //get specific supplyco
  exports.getSupplycosByTaluk = async (req, res) => {
    try {
        const { taluk } = req.query;

        if (!taluk) {
            return res.status(200).json({ message: "Taluk parameter is required." });
        }

        const supplycosSnapshot = await db.collection("supplycos")
            .where("taluk", ">=", taluk)
            .where("taluk", "<", taluk + "\uf8ff")
            .get();

        if (supplycosSnapshot.empty) {
            return res.status(404).json({ message: `No supplycos found for taluk starting with: ${taluk}` });
        }

        let supplycos = [];
        supplycosSnapshot.forEach(doc => {
            supplycos.push({ id: doc.id, ...doc.data() });
        });

        return res.status(200).json({ supplycos });
    } catch (error) {
        console.error("❌ Error fetching supplycos by taluk:", error);
        return res.status(500).json({ error: "Internal server error", details: error.message });
    }
};


exports.getUserProfile = async (req, res) => {
  const { cardNumber } = req.params;

  if (!cardNumber) {
      return res.status(400).json({ error: "Missing card number" });
  }

  try {
      // 🔍 Fetch user details from Firestore (users collection)
      const userRef = db.collection("users").doc(cardNumber);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
          return res.status(404).json({ error: "User not found" });
      }

      // ✅ Extract user data
      const userData = userDoc.data();
      const rationType = userData.rationType; // APL or BPL

      // 🔍 Fetch quota details for the current month
      const currentMonthYear = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
      const quotaDoc = await db.collection('monthlyQuotas').doc(currentMonthYear).get();

      if (!quotaDoc.exists) {
          return res.status(404).json({ error: "Quota details not found for the current month." });
      }

      const quotaData = quotaDoc.data();
      const quotaProducts = quotaData.products; // List of products with quota limits

      // ✅ Calculate quota allotted for the user's ration type
      const quotaAllotted = {};
      for (const product of quotaProducts) {
          const productName = product.name;
          const productQuota = product.quota[rationType] || 0; // Quota for the user's ration type
          quotaAllotted[productName] = productQuota;
      }

      // ✅ Handle usedQuota if it's null or missing
      const usedQuota = userData.usedQuota || {}; // Default to an empty object if usedQuota is null or missing

      // ✅ Add quotaAllotted and usedQuota to userData
      userData.quotaAllotted = quotaAllotted;
      userData.usedQuota = usedQuota; // Ensure usedQuota is included in the response

      res.status(200).json({
          user: userData // Include quotaAllotted and usedQuota in the user object
      });

  } catch (error) {
      console.error("Error fetching user profile:", error);
      res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.sendFeedBack = async (req, res) => {
  const { feedBack, supplycoId, cardNumber } = req.body;

  if (!feedBack || !supplycoId || !cardNumber) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    const supplycoRef = db.collection("Supplycos").doc(supplycoId);
    const supplycoDoc = await supplycoRef.get();

    if (!supplycoDoc.exists) {
      return res.status(400).json({ error: "Supplyco doesn't exist" });
    }

    const data = {
      cardNumber,
      feedBack,
      timestamp: admin.firestore.FieldValue.serverTimestamp(), // Add timestamp
    };

    // ✅ Correct way to add a document inside a subcollection
    await supplycoRef.collection("FeedBack").add(data);

    res.status(200).json({ success: "Feedback has been added" });
  } catch (e) {
    console.error("Error sending feedback: ", e);
    res.status(500).json({ error: "Internal server error" });
  }
};

  