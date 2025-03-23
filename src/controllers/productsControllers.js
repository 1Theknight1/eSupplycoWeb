/* eslint-disable */

const { db, rtdb } = require("../utils/firebase-config");
const admin = require("firebase-admin");



// Fetch products for a specific Supplyco
exports.supplycoBasedProducts = async (req, res) => {
  try {
    const { supplycoId } = req.params;
    if (!supplycoId) {
      return res.status(400).json({ error: "Supplyco ID is required" });
    }

    console.log(`📡 Fetching stock for Supplyco: ${supplycoId}`);

    // Get stock from Realtime Database
    const stockRef = rtdb.ref(`stock_updates/${supplycoId}`);
    const stockSnapshot = await stockRef.once("value");
    const stockData = stockSnapshot.val();

    if (!stockData) {
      return res.status(404).json({ message: "No products available at this Supplyco location" });
    }

    console.log(`📦 Stock found:`, stockData);

    // Get product details from Firestore (from the supplyco's subcollection)
    const productIds = Object.keys(stockData);
    const productPromises = productIds.map((id) =>
      db.collection("supplycos").doc(supplycoId).collection("products").doc(id).get()
    );
    
    const productSnapshots = await Promise.all(productPromises);

    let products = [];
    productSnapshots.forEach((doc) => {
      if (doc.exists) {
        const data = doc.data();
        products.push({
          id: doc.id,
          ...data,
          stock: stockData[doc.id]?.stock || 0,
          available: stockData[doc.id]?.available || false
        });
      }
    });

    console.log(`🛒 Final product list:`, products);
    res.json(products);
  } catch (error) {
    console.error("🔥 Error fetching products:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Search products within a specific Supplyco
exports.searchProduct = async (req, res) => {
  try {
    console.log("🔹 Full Request URL:", req.originalUrl);
    console.log("🔹 Received Query Params:", req.query);

    const { query, supplycoId } = req.query;
    if (!query || !supplycoId) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    console.log(`📡 Searching for "${query}" in Supplyco ID: ${supplycoId}`);

    // Fetch product names from RTDB
    const stockRef = rtdb.ref(`stock_updates/${supplycoId}`);
    const stockSnapshot = await stockRef.once("value");

    console.log(`📦 RTDB Data for supplycoId ${supplycoId}:`, stockSnapshot.val());
    if (!stockSnapshot.exists()) {
      return res.status(404).json({ message: `No products available at this Supplyco location.` });
    }

    const productNames = Object.keys(stockSnapshot.val()); // Get product names from RTDB
    console.log(`🛒 Products in stock at ${supplycoId}:`, productNames);

    // Fetch matching products from Firestore
    const productQuerySnapshot = await db
      .collection("supplycos")
      .doc(supplycoId)
      .collection("products")
      .where("name", "in", productNames)
      .get();

    console.log(`📜 Firestore Query Result Count:`, productQuerySnapshot.size);

    if (productQuerySnapshot.empty) {
      return res.status(404).json({ message: "No matching products found in Firestore." });
    }

    // Filter products based on user search query
    const matchingProducts = productQuerySnapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(product => product.name.toLowerCase().includes(query.toLowerCase()));

    console.log(`✅ Final Matching Products:`, matchingProducts);
    if (matchingProducts.length === 0) {
      return res.status(404).json({ message: "No matching products found." });
    }

    return res.status(200).json({ products: matchingProducts });
  } catch (error) {
    console.error("🔥 Error searching product:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};



//calculate quota of user
exports.calcDiscount = async (req, res) => {
  try {
    const { cardNumber, supplycoId, products } = req.body;

    // Input validation
    if (!cardNumber || !supplycoId || !products || !Array.isArray(products)) {
      return res.status(400).json({ message: "Invalid request format." });
    }

    let userData = null;
    let usedQuota = {}; // Default: No used quota for non-eSupplyco users

    // Check if user exists in "users" collection (eSupplyco user)
    let userDoc = await db.collection("users").doc(cardNumber).get();
    if (userDoc.exists) {
      userData = userDoc.data();
      usedQuota = userData.usedQuota || {}; // Fetch used quota
    } else {
      // If not found, check in "rationCardHolder" collection (non-eSupplyco user)
      let rationCardDoc = await db.collection("rationCardHolder").doc(cardNumber).get();
      if (rationCardDoc.exists) {
        userData = rationCardDoc.data();
      } else {
        return res.status(400).json({ message: "User not found." });
      }
    }

    const rationType = userData.rationType; // APL or BPL

    // Fetch quota details for the current month
    const currentMonthYear = new Date().toLocaleString("default", { month: "long", year: "numeric" });
    const quotaDoc = await db.collection("monthlyQuotas").doc(currentMonthYear).get();
    if (!quotaDoc.exists) {
      return res.status(400).json({ message: "Quota details not found for the current month." });
    }

    const quotaData = quotaDoc.data();
    const quotaProducts = quotaData.products; // List of products with quota limits

    let totalFinalPrice = 0;
    let responseProducts = [];
    let remainingQuota = {};

    // Process each product
    for (const item of products) {
      const { productId, quantity } = item;

      // Validate quantity
      if (typeof quantity !== "number" || quantity <= 0) {
        return res.status(400).json({ message: `Invalid quantity for product ${productId}.` });
      }

      // Fetch product details
      const productDoc = await db.collection("supplycos").doc(supplycoId).collection("products").doc(productId).get();
      if (!productDoc.exists) {
        return res.status(400).json({ message: `Product ${productId} not found.` });
      }

      const productData = productDoc.data();
      const unit = productData.unit || "none";
      const subsidizedPrice = productData.subsidizedPrice || 0; // Subsidized price
      const marketPrice = productData.marketPrice || 0; // Market price

      // Find quota details for the product
      const quotaProduct = quotaProducts.find((p) => p.name === productId);
      if (!quotaProduct) {
        return res.status(400).json({ message: `Quota details not found for product ${productId}.` });
      }

      const quotaLimit = quotaProduct.quota[rationType] || 0; // Quota limit for the user's ration type
      const remainingQuotaForProduct = quotaLimit - (usedQuota[productId] || 0);

      let subsidizedQuantity = Math.min(quantity, remainingQuotaForProduct);
      let excessQuantity = Math.max(quantity - remainingQuotaForProduct, 0);

      // Calculate prices
      const subsidizedTotal = subsidizedQuantity * subsidizedPrice;
      const marketTotal = excessQuantity * marketPrice;
      const totalPrice = subsidizedTotal + marketTotal;

      // Update remaining quota (for response only, not saved to DB yet)
      remainingQuota[productId] = remainingQuotaForProduct - subsidizedQuantity;

      // Update totals
      totalFinalPrice += totalPrice;

      // Add product details to response
      responseProducts.push({
        unit,
        productId,
        quantity,
        subsidizedQuantity,
        excessQuantity,
        subsidizedPrice,
        marketPrice,
        subsidizedTotal,
        marketTotal,
        totalPrice,
      });
    }

    // Send response
    res.status(200).json({
      message: "Quota calculated successfully",
      data: {
        cardNumber,
        rationType,
        products: responseProducts,
        totalFinalPrice,
        remainingQuota,
      },
    });
  } catch (error) {
    console.error("❌ Error calculating quota:", error.message, error.stack);
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
};


//getBill
exports.getBill = async (req, res) => {
  try {
    const { cardNumber, supplycoId, products } = req.body;

    // Input validation
    if (!cardNumber || !supplycoId || !products || !Array.isArray(products)) {
      return res.status(400).json({ message: "Invalid request format." });
    }

    let userData = null;
    let usedQuota = {};
    let isNonUser = false;

    // Check if user exists in "users" collection (eSupplyco user)
    let userDoc = await db.collection("users").doc(cardNumber).get();
    if (userDoc.exists) {
      userData = userDoc.data();
      usedQuota = userData.usedQuota || {};
    } else {
      // If not found, check in "nonUsers" collection (non-eSupplyco user)
      let nonUserDoc = await db.collection("nonUsers").doc(cardNumber).get();
      if (nonUserDoc.exists) {
        userData = nonUserDoc.data();
        usedQuota = userData.usedQuota || {};
        isNonUser = true;
      } else {
        // First-time non-eSupplyco user → Fetch from rationCardHolder
        let rationDoc = await db.collection("rationCardHolder").doc(cardNumber).get();
        if (!rationDoc.exists) {
          return res.status(400).json({ message: "Ration card details not found." });
        }
        const rationData = rationDoc.data();
        userData = { rationType: rationData.rationType }; // Fetch ration type
        usedQuota = {}; // Initialize empty usedQuota
        isNonUser = true;
      }
    }

    const rationType = userData.rationType;
    const currentMonthYear = new Date().toLocaleString("default", { month: "long", year: "numeric" });

    // Fetch quota details
    const quotaDoc = await db.collection("monthlyQuotas").doc(currentMonthYear).get();
    if (!quotaDoc.exists) {
      return res.status(400).json({ message: "Quota details not found for the current month." });
    }
    const quotaData = quotaDoc.data();
    const quotaProducts = quotaData.products;

    let totalFinalPrice = 0;
    let purchasedProducts = [];

    for (const item of products) {
      const { productId, quantity } = item;

      // Validate quantity
      if (typeof quantity !== "number" || quantity <= 0) {
        return res.status(400).json({ message: `Invalid quantity for product ${productId}.` });
      }

      // Fetch product details
      const productDoc = await db.collection("supplycos").doc(supplycoId).collection("products").doc(productId).get();
      if (!productDoc.exists) {
        return res.status(400).json({ message: `Product ${productId} not found.` });
      }

      const productData = productDoc.data();
      const unit = productData.unit || "none";
      const subsidizedPrice = productData.subsidizedPrice || 0;
      const marketPrice = productData.marketPrice || 0;

      // Find quota details
      const quotaProduct = quotaProducts.find(p => p.name === productId);
      if (!quotaProduct) {
        return res.status(400).json({ message: `Quota details not found for product ${productId}.` });
      }

      const quotaLimit = quotaProduct.quota[rationType] || 0;
      const remainingQuotaForProduct = quotaLimit - (usedQuota[productId] || 0);

      let subsidizedQuantity = Math.min(quantity, remainingQuotaForProduct);
      let excessQuantity = Math.max(quantity - remainingQuotaForProduct, 0);

      // Calculate prices
      const subsidizedTotal = subsidizedQuantity * subsidizedPrice;
      const marketTotal = excessQuantity * marketPrice;
      const totalPrice = subsidizedTotal + marketTotal;

      // Update used quota
      usedQuota[productId] = (usedQuota[productId] || 0) + subsidizedQuantity;

      // Add to purchased products
      purchasedProducts.push({
        unit,
        productId,
        quantity,
        subsidizedQuantity,
        excessQuantity,
        subsidizedPrice,
        marketPrice,
        subsidizedTotal,
        marketTotal,
        totalPrice,
      });

      totalFinalPrice += totalPrice;
    }

    // Store purchase details in Firestore
    const billData = {
      cardNumber,
      rationType,
      supplycoId,
      purchasedProducts,
      totalFinalPrice,
      timestamp: new Date(),
    };

    await db.collection("bills").add(billData);

    // Update user's used quota
    if (isNonUser) {
      await db.collection("nonUsers").doc(cardNumber).set(
        { rationType, usedQuota },
        { merge: true }
      );
    } else {
      await db.collection("users").doc(cardNumber).update({ usedQuota });
    }

    res.status(200).json({
      message: "Bill generated successfully",
      data: billData,
    });

  } catch (error) {
    console.error("❌ Error generating bill:", error.message, error.stack);
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
};
