/* eslint-disable */

const admin=require("firebase-admin")
const {db,rtdb}=require("../utils/firebase-config")


async function logApiCall( action) {
  const logRef = db.collection("logs").doc();
  await logRef.set({
   
    action: action, // Custom action description
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log("saved orders log");
}

exports.placeOrder = async (req, res) => {
    try {
        const { products, cardNumber, supplycoId, orderType, totalPrice, remainingQuota, latitude, longitude } = req.body;

        // ✅ Validate request body
        if (!products || !Array.isArray(products) || !cardNumber || !supplycoId || !orderType || !totalPrice || !remainingQuota) {
            return res.status(400).json({ message: "Invalid request format. Required fields missing." });
        }

        // ✅ Validate location for delivery orders
        if (orderType === "Delivery" && (!latitude || !longitude)) {
            return res.status(400).json({ message: "Latitude and longitude are required for delivery orders." });
        }

        console.log(`🛒 New Order: User ${cardNumber} ordering ${products.length} products from ${supplycoId}`);

        // ✅ Fetch user details
        const userRef = db.collection("users").doc(cardNumber);
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
            return res.status(404).json({ message: "User not found" });
        }

        const userData = userDoc.data();
        const rationType = userData.rationType; // APL or BPL

        // ✅ Fetch quota details for the current month
        const currentMonthYear = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
        const quotaDoc = await db.collection('monthlyQuotas').doc(currentMonthYear).get();
        const quotaData = quotaDoc.exists ? quotaDoc.data() : { products: [] };
        const quotaProducts = quotaData.products || []; // List of products with quota limits

        // ✅ Validate stock and calculate used quota
        const failedItems = [];
        let totalFinalPrice = 0;
        let responseProducts = [];
        let newUsedQuota = {}; // Store used quota for the current order

        for (const item of products) {
            const { productId, quantity } = item;

            console.log(`🔍 Checking stock and quota for ${productId}, requested quantity: ${quantity}`);

            // Fetch stock from Realtime Database
            const stockRef = rtdb.ref(`stock_updates/${supplycoId}/${productId}/stock`);
            const stockSnapshot = await stockRef.once("value");
            const stock = stockSnapshot.val();

            if (stock === null || stock < quantity) {
                failedItems.push({ productId, reason: "Not enough stock" });
                continue; // Skip to the next product
            }

            // Fetch product details
            const productDoc = await db.collection('supplycos').doc(supplycoId).collection('products').doc(productId).get();
            if (!productDoc.exists) {
                failedItems.push({ productId, reason: "Product not found" });
                continue;
            }

            const productData = productDoc.data();
            const subsidizedPrice = productData.subsidizedPrice || 0;
            const marketPrice = productData.marketPrice || 0;

            // Find quota details for the product
            const quotaProduct = quotaProducts.find(p => p.name === productId);
            
            let subsidizedQuantity = 0;
            let excessQuantity = quantity;
            let subsidizedTotal = 0;
            let marketTotal = quantity * marketPrice;

            if (quotaProduct) {
                const quotaLimit = quotaProduct.quota[rationType] || 0;
                const remainingQuotaForProduct = remainingQuota[productId] || 0;

                // Calculate subsidized and excess quantities
                subsidizedQuantity = Math.min(quantity, remainingQuotaForProduct);
                excessQuantity = Math.max(quantity - subsidizedQuantity, 0);

                // Calculate prices
                subsidizedTotal = subsidizedQuantity * subsidizedPrice;
                marketTotal = excessQuantity * marketPrice;
            }

            const totalPrice = subsidizedTotal + marketTotal;

            // ✅ Update used quota for the current order
            newUsedQuota[productId] = (newUsedQuota[productId] || 0) + subsidizedQuantity;

            // Update totals
            totalFinalPrice += totalPrice;

            // Add product details to response
            responseProducts.push({
                productId,
                quantity,
                subsidizedQuantity,
                excessQuantity,
                subsidizedPrice,
                marketPrice,
                subsidizedTotal,
                marketTotal,
                totalPrice
            });

            // ✅ Deduct stock safely using Firebase Transaction
            const stockUpdated = await stockRef.transaction((currentStock) => {
                if (currentStock === null || currentStock < quantity) return currentStock;
                return currentStock - quantity;
            });

            if (!stockUpdated.committed) {
                failedItems.push({ productId, reason: "Stock update failed" });
            }
        }

        // ❌ If stock or quota validation failed for any product, reject the entire order
        if (failedItems.length > 0) {
            return res.status(400).json({ message: "Order failed due to stock or quota issues.", failedItems });
        }

        // ✅ Generate a token number specific to the supplycoId
        const supplycoRef = db.collection("supplycos").doc(supplycoId);
        const supplycoDoc = await supplycoRef.get();

        if (!supplycoDoc.exists) {
            return res.status(404).json({ message: "Supplyco not found" });
        }

        const currentDate = new Date().toISOString().split("T")[0];
        const supplycoData = supplycoDoc.data();
        const lastResetDate = supplycoData.lastResetDate || null;
        const name = supplycoData.name || null;

        let tokenNumber = 1;
        if (lastResetDate === currentDate) {
            tokenNumber = (supplycoData.tokenNumber || 0) + 1;
        }

        // Update the supplyco document with the new token number and last reset date
        await supplycoRef.update({
            tokenNumber,
            lastResetDate: currentDate,
        });

        // ✅ Save the order in Firestore
        const orderData = {
            cardNumber,
            supplycoId,
            orderType,
            ...(orderType === "Delivery" && { location: { latitude, longitude } }),
            products: responseProducts,
            totalPrice: totalFinalPrice,
            name,
            status: "In progress",
            expired: false,
            tokenNumber,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
        };

        const orderRef = await db.collection("orders").add(orderData);

        // ✅ Update user's used quota in Firestore
        const existingUsedQuota = userDoc.data().usedQuota || {};
        const updatedUsedQuota = { ...existingUsedQuota };

        for (const [productId, quantity] of Object.entries(newUsedQuota)) {
            updatedUsedQuota[productId] = (updatedUsedQuota[productId] || 0) + quantity;
        }

        await userRef.update({
            usedQuota: updatedUsedQuota,
        });

        await logApiCall(`${cardNumber} placed a ${orderType} order at ${supplycoId}`);

        console.log(`📦 Order placed successfully: ${orderRef.id}, Token Number: ${tokenNumber}`);
        res.status(201).json({ message: "Order placed successfully!", orderId: orderRef.id, tokenNumber });

    } catch (error) {
        console.error("❌ Error placing order:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};


//calculate discount
exports.calculateDiscount = async (req, res) => {
  try {
      const { cardNumber, supplycoId, products } = req.body;
      
      if (!products || !Array.isArray(products) || !cardNumber || !supplycoId) {
          return res.status(400).json({ message: "Invalid request format." });
      }

      const userDoc = await db.collection("users").doc(cardNumber).get();
      if (!userDoc.exists) {
          return res.status(400).json({ message: "User not found" });
      }

      const userData = userDoc.data();
      const rationType = userData.rationType; // Get user type (APL/BPL)
      const famSize = userData.familySize || 1;
      

      let totalBeforeDiscount = 0;
      let finalQuota = 0;
      let totalDiscount = 0;
      let totalFinalPrice = 0;
      let responseProducts = [];

      for (const item of products) {
          const { productId, quantity } = item;
          const productDoc = await db.collection("supplycos").doc(supplycoId).collection('products').doc(productId).get()

          if (!productDoc.exists) {
              return res.status(400).json({ message: `Product ${productId} not found` });
          }

          const productData = productDoc.data();
          const pricePerUnit = productData.price;
          const totalPrice = pricePerUnit * quantity;
          
          let discount = productData.discounts?.[rationType] || 0;
          if (productData.unit?.toLowerCase() === "kg") {
              discount *= famSize; // Apply family-size-based discount
          }

          const finalPrice = Math.max(totalPrice - discount, 0);

          totalBeforeDiscount += totalPrice;
          totalDiscount += discount;
          totalFinalPrice += finalPrice;
          finalQuota=quota-totalFinalPrice
          

          responseProducts.push({
              productId,
              quantity,
              pricePerUnit,
              totalPrice,
              discount,
              finalPrice
          });
      }

      res.status(200).json({
          products: responseProducts,
          totalPriceBeforeDiscount: totalBeforeDiscount,
          totalDiscount: totalDiscount,
          totalFinalPrice: totalFinalPrice
      });

  } catch (error) {
      console.error("❌ Error calculating discount:", error);
      res.status(500).json({ error: "Internal server error", details: error.message });
  }
};


//get user specific orders
exports.getOrdersByNumber = async (req, res) => {
    try {
      const { cardNumber } = req.params;
  
      console.log(`📢 Fetching orders for Card Number: ${cardNumber}`);
  
      // 🔍 Query orders where `cardNumber` matches
      const ordersSnapshot = await db
        .collection("orders")
        .where("cardNumber", "==", cardNumber)
        .orderBy("timestamp", "desc") // Order by latest first
        .get();
  
      if (ordersSnapshot.empty) {
        return res.status(404).json({ message: "No orders found for this card number." });
      }
  
      // 📦 Map orders into an array
      const orders = ordersSnapshot.docs.map(doc => ({
        orderId: doc.id,
        ...doc.data(),
      }));
  
      res.status(200).json({ orders });
  
    } catch (error) {
      console.error("❌ Error fetching orders:", error);
      res.status(500).json({ message: "Internal server error", error: error.message });
    }
  };


  //cancel order

exports.cancelOrder = async (req, res) => {
    try {
        const { orderId } = req.params;

        if (!orderId) {
            return res.status(400).json({ message: "Order ID is required." });
        }

        const orderRef = db.collection("orders").doc(orderId);
        const orderSnapshot = await orderRef.get();

        if (!orderSnapshot.exists) {
            return res.status(404).json({ message: "Order not found." });
        }

        const orderData = orderSnapshot.data();

        // Check if the order is already collected or expired
        if (orderData.status === "collected" || orderData.expired === true) {
            return res.status(400).json({ message: "Order cannot be canceled." });
        }

        // ✅ Update the order status to 'canceled'
        await orderRef.update({
            expired:true,
            status: "canceled",
            canceledAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await logApiCall(`Order:${orderId} was cancelled `);
        res.status(200).json({ message: "Order canceled successfully." });

    } catch (error) {
        console.error("❌ Error canceling order:", error);
        res.status(500).json({ error: "Internal server error", details: error.message });
    }
};

//get only active orders
exports.getActiveOrdersByNumber = async (req, res) => {
    try {
        const { cardNumber } = req.params;

        console.log(`📢 Fetching orders for Card Number: ${cardNumber}`);

        // 🔍 Query orders where `cardNumber` matches and `expired` is false
        const ordersSnapshot = await db
            .collection("orders")
            .where("cardNumber", "==", cardNumber)
            .where("expired", "==", false) // Filter expired: false
            .orderBy("timestamp", "desc") // Order by latest first
            .get();

        if (ordersSnapshot.empty) {
            return res.status(404).json({ message: "No active orders found for this card number." });
        }

        // 📦 Map orders into an array
        const orders = ordersSnapshot.docs.map(doc => ({
            orderId: doc.id,
            ...doc.data(),
        }));

        res.status(200).json({ orders });

    } catch (error) {
        console.error("❌ Error fetching orders:", error);
        res.status(500).json({ message: "Internal server error", error: error.message });
    }
};








//get order history
exports.getHistory = async (req, res) => {
    try {
        const cardNumber = req.params.cardNumber;
        if (!cardNumber) {
            return res.status(400).json({ error: "Missing cardNumber parameter" });
        }

        const supplycosSnapshot = await db.collection("supplycos").get();
        let bookingHistory = [];

        console.log(`🔍 Searching for bookings of cardNumber: ${cardNumber}`);

        // 🔍 Loop through all supplycos
        for (const supplycoDoc of supplycosSnapshot.docs) {
            const supplycoId = supplycoDoc.id;
            const supplycoName = supplycoDoc.data().name || "Unknown Supplyco";

            console.log(`📌 Checking supplyco: ${supplycoId} - ${supplycoName}`);

            const bookingsSnapshot = await db
                .collection(`supplycos/${supplycoId}/bookings`)
                .get();

            // 🔍 Loop through all bookings (dates)
            for (const bookingDoc of bookingsSnapshot.docs) {
                const date = bookingDoc.id;
                const slotsData = bookingDoc.data();

                console.log(`📅 Checking date: ${date}`);

                // 🔍 Loop through all slots in the date document
                for (const [slotId, slotInfo] of Object.entries(slotsData)) {
                    if (slotInfo.users) {
                        for (const user of slotInfo.users) {
                            if (user.cardNumber === cardNumber) {
                                bookingHistory.push({
                                    supplycoId,
                                    supplycoName,
                                    date,
                                    slotId,
                                    bookedAt: user.bookedAt || new Date().toISOString(), // ✅ Ensure a valid timestamp
                                });
                            }
                        }
                    }
                }
            }
        }

        // 🔥 Sort bookings by `bookedAt` in DESCENDING order (latest bookings first)
        bookingHistory.sort((a, b) => new Date(b.bookedAt) - new Date(a.bookedAt));

        res.status(200).json({
            history: bookingHistory, // ✅ Renamed `slots` to `history` for clarity
        });
    } catch (error) {
        console.error("❌ Error fetching booking history:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};


//change order state
exports.changeOrderStatue= async (req, res) => {
    try {
      const { orderId } = req.params;
      const { status } = req.body;
  
      if (!status) {
        return res.status(400).json({ message: "Status is required" });
      }
  
      const orderRef = db.collection("orders").doc(orderId);
      const orderDoc = await orderRef.get();
  
      if (!orderDoc.exists) {
        return res.status(404).json({ message: "Order not found" });
      }
  
      await orderRef.update({ status });
      await logApiCall(`Order : ${orderId}  updated to ${status}` );
  
      return res.status(200).json({ message: `Order ${orderId} updated to ${status}` });
    } catch (error) {
      return res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
  };

  //sent to delivery app
 exports.assignDelivery= async (req, res) => {
    try {
      const { supplycoId,orderId } = req.body;
  
      // Validate the request
      if (!orderId ) {
        return res.status(400).json({ message: "Order ID is required." });
      }
  
      // Fetch the order from the orders collection
      const orderRef = db.collection("orders").doc(orderId);
      const orderDoc = await orderRef.get();
  
      if (!orderDoc.exists) {
        return res.status(404).json({ message: "Order not found." });
      }
  
      const orderData = orderDoc.data();
  
      // Check if the order is already in the Delivery collection
      const deliveryRef = db.collection("Delivery").doc(orderId);
      const deliveryDoc = await deliveryRef.get();
  
      if (deliveryDoc.exists) {
        return res.status(400).json({ message: "Order is already in the Delivery collection." });
      }
  
      // Copy the order to the Delivery collection
      await deliveryRef.set(orderData);
  
      // Update the status of the order in the orders collection to "assigning"
      await orderRef.update({ status: "assigning" });
      await logApiCall(`Order:${orderId} assigned to Delivery App at ${supplycoId}` );
  
      // Respond with success
      res.status(200).json({ message: "Order assigned for delivery successfully.", orderId });
    } catch (error) {
      console.error("❌ Error assigning order for delivery:", error);
      res.status(500).json({ message: "Internal server error.", error: error.message });
    }
  };