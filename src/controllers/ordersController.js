/* eslint-disable */

const admin=require("firebase-admin")
const {db,rtdb,fcm}=require("../utils/firebase-config")


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

        const supplycoData = supplycoDoc.data();
        const name = supplycoData.name || null;
        
        let tokenNumber = null;

        if (orderType !== "Delivery") {
            const currentDate = new Date().toISOString().split("T")[0];
            const lastResetDate = supplycoData.lastResetDate || null;

            tokenNumber = 1;
            if (lastResetDate === currentDate) {
                tokenNumber = (supplycoData.tokenNumber || 0) + 1;
            }

            // Update token number only for Pickup orders
            await supplycoRef.update({
                tokenNumber,
                lastResetDate: currentDate,
            });
        }

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
            ...(tokenNumber !== null && { tokenNumber }), // Only add tokenNumber for non-delivery orders
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

        console.log(`📦 Order placed successfully: ${orderRef.id}${tokenNumber !== null ? `, Token Number: ${tokenNumber}` : ''}`);
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
      const { status ,cardNumber} = req.body;
  
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
      if(status=="Ready"){

        const userDoc = await admin.firestore().collection("users").doc(cardNumber).get();
            if (userDoc.exists) {
                const fcm = userDoc.data().fcmToken;
                if (fcm) {
                    sendTestNotification(fcm, "Order updates", "Your order is ready to collect");
                }
            }
      
  
      }
      return res.status(200).json({ message: `Order ${orderId} updated to ${status}` });
    } catch (error) {
      return res.status(500).json({ message: "Internal Server Error", error: error.message });
    }
  };

  //sent to delivery app
  exports.assignDelivery = async (req, res) => {
    try {
        console.log("🚀 Received API Request: /api/orders/assignDelivery");
        console.log("📦 Request Body:", req.body);

        const { supplycoId, orderId } = req.body;

        // Validate the request
        if (!orderId || !supplycoId) {
            console.error("⚠️ Validation Error: Missing orderId or supplycoId.");
            return res.status(400).json({ message: "Order ID and Supplyco ID are required." });
        }

        console.log(`🔍 Checking Firestore for Order ID: ${orderId} and Supplyco ID: ${supplycoId}`);

        // Firestore transaction for atomic operations
        await db.runTransaction(async (transaction) => {
            const orderRef = db.collection("orders").doc(orderId);
            const deliveryRef = db.collection("Delivery").doc(orderId);

            const orderDoc = await transaction.get(orderRef);
            if (!orderDoc.exists) {
                console.error(`❌ Order Not Found: ${orderId}`);
                throw new Error("Order not found.");
            }

            const deliveryDoc = await transaction.get(deliveryRef);
            if (deliveryDoc.exists) {
                console.error(`⚠️ Order Already Assigned for Delivery: ${orderId}`);
                throw new Error("Order is already in the Delivery collection.");
            }

            console.log(`✅ Order ${orderId} found. Proceeding with assignment...`);

            // Copy order data to Delivery collection
            transaction.set(deliveryRef, orderDoc.data());

            // Update order status
            transaction.update(orderRef, { status: "assigning" });

            console.log(`🚚 Order ${orderId} assigned to delivery at Supplyco ${supplycoId}`);
        });

        // Log the API call
        await logApiCall(`📜 Order:${orderId} assigned to Delivery App at ${supplycoId}`);

        // Respond with success
        console.log(`✅ API Success: Order ${orderId} successfully assigned for delivery.`);
        res.status(200).json({ message: "Order assigned for delivery successfully.", orderId });

    } catch (error) {
        console.error("❌ Error assigning order for delivery:", error.message);
        res.status(500).json({ message: error.message || "Internal server error." });
    }
};


  
async function sendTestNotification(token,title,body) {
    const message = {
      token: token,
      notification: {
        title: title,
        body: body,
      },
    };
  
    try {
      const response = await fcm.send(message);
      console.log("✅ Message sent successfully:", response);
    } catch (error) {
      console.error("❌ Error sending message:", error);
    }
  }



  exports.updateOutForDelivery = async (req, res) => {
    try {
        const { orderId, deliveryBoyId, status, cardNumber } = req.body;
        if (!orderId || !deliveryBoyId || !status || !cardNumber) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const deliveryRef = admin.firestore().collection("Delivery").doc(orderId);
        const orderRef = admin.firestore().collection("orders").doc(orderId);
        const deliveryDoc = await deliveryRef.get();
        const timestamp = admin.firestore.FieldValue.serverTimestamp();

        if (!deliveryDoc.exists) {
            return res.status(404).json({ error: "Order not found in Delivery collection" });
        }

        const currentStatus = deliveryDoc.data().status;
        const deliveryBoyRef = admin.firestore().collection("deliveryBoy").doc(deliveryBoyId);
        const deliveryBoyOrderRef = deliveryBoyRef.collection("orders").doc(orderId);

        if (currentStatus === "In progress" && status === "Out For Delivery") {
            await deliveryRef.update({ status: "Out For Delivery", deliveryBoy: deliveryBoyId });
            await orderRef.update({ status: "Out For Delivery", deliveryBoy: deliveryBoyId });

            // Fetch order details
            const orderData = await orderRef.get();
            if (orderData.exists) {
                // Copy order data to deliveryBoy's subcollection
                await deliveryBoyOrderRef.set({
                    ...orderData.data(),
                    status: "Out For Delivery",
                    assignedAt: timestamp,
                });
            }

            // Send notification to user
            const userDoc = await admin.firestore().collection("users").doc(cardNumber).get();
            if (userDoc.exists) {
                const fcm = userDoc.data().fcmToken;
                if (fcm) {
                    sendTestNotification(fcm, "Order updates", "Your order is out for delivery");
                }
            }

            return res.json({ success: true, message: "Order marked as Out For Delivery" });
        }

        if (currentStatus === "Out For Delivery" && status === "Delivered") {
            // Fetch order details to calculate earnings
            const orderData = await orderRef.get();
            let earnings = 0;
            if (orderData.exists) {
                const totalPrice = orderData.data().totalPrice || 0; // Ensure totalPrice exists
                earnings = (totalPrice * 0.1).toFixed(2); // 10% of total price
            }

            await deliveryRef.update({ status: "Delivered", deliveredAt: timestamp });
            await orderRef.update({ status: "Delivered", deliveredAt: timestamp });

            // Update order status and earnings in deliveryBoy's subcollection
            await deliveryBoyOrderRef.update({
                status: "Delivered",
                deliveredAt: timestamp,
                earnings: earnings,
            });

            // Update total earnings of the delivery boy
            await admin.firestore().runTransaction(async (transaction) => {
                const deliveryBoyDoc = await transaction.get(deliveryBoyRef);
                if (deliveryBoyDoc.exists) {
                    const currentEarnings = deliveryBoyDoc.data().earnings || 0;
                    transaction.update(deliveryBoyRef, {
                        earnings: currentEarnings + parseFloat(earnings),
                    });
                }
            });

            // Send notification to user
            const userDoc = await admin.firestore().collection("users").doc(cardNumber).get();
            if (userDoc.exists) {
                const fcm = userDoc.data().fcmToken;
                if (fcm) {
                    sendTestNotification(fcm, "Order updates", "Your order is successfully delivered. Thank you for ordering from eSupplyco");
                }
            }

            return res.json({ success: true, message: "Order marked as Delivered", earnings: earnings });
        }

        return res.status(400).json({ error: "Invalid status transition" });
    } catch (error) {
        console.error("Error updating delivery status:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};


//get orders of deliveryboy
exports.getDeliveryBoyOrders = async (req, res) => {
    try {
        const { deliveryBoyId } = req.params;

        if (!deliveryBoyId) {
            return res.status(400).json({ error: "Missing deliveryBoyId parameter" });
        }

        const ordersRef = admin.firestore().collection("deliveryBoy").doc(deliveryBoyId).collection("orders");
        const snapshot = await ordersRef.get();

        if (snapshot.empty) {
            return res.json({ success: true, orders: [], message: "No orders found" });
        }

        const orders = await Promise.all(
            snapshot.docs.map(async (doc) => {
                const orderData = doc.data();
                const cardNumber = orderData.cardNumber;

                let phoneNumber = null;
                let address = null;

                // Fetch user details from "users" collection using cardNumber
                if (cardNumber) {
                    const userDoc = await admin.firestore().collection("users").doc(cardNumber).get();
                    if (userDoc.exists) {
                        const userData = userDoc.data();
                        phoneNumber = userData.phoneNumber || null;
                        address = userData.address || null;
                    }
                }

                return {
                    id: doc.id,
                    ...orderData,
                    phoneNumber,
                    address
                };
            })
        );

        return res.json({ success: true, orders });
    } catch (error) {
        console.error("Error fetching orders for delivery boy:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};

