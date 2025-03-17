/* eslint-disable */

const {db,rtdb}=require("../utils/firebase-config")
const admin=require("firebase-admin")

// //Book a slot
// exports.bookSlot= async (req, res) => {
//     try {
//       const { supplycoId } = req.params;
//       const { cardNumber, slotId, booking_date } = req.body;
      
//       if (!cardNumber || !slotId || !booking_date) {
//         return res.status(400).json({ message: "Missing required fields" });
//       }
  
//       const slotRef = db.doc(`supplycos/${supplycoId}/slots/${slotId}`);
//       const slotSnapshot = await slotRef.get();
  
//       if (!slotSnapshot.exists) {
//         return res.status(404).json({ message: "Slot not found" });
//       }
  
//       const slotData = slotSnapshot.data();
//       if (slotData.booked_count >= slotData.capacity) {
//         return res.status(400).json({ message: "Slot fully booked" });
//       }
  
//       // ✅ Update slot count
//       await slotRef.update({ booked_count: admin.firestore.FieldValue.increment(1) });
  
//       // ✅ Store the booking
//       const bookingRef = await db.collection("bookings").add({
//         cardNumber,
//         supplycoId,
//         slotId,
//         booking_date,
//         timestamp: admin.firestore.FieldValue.serverTimestamp(),
//       });
  
//       res.status(201).json({ message: "Slot booked successfully!", bookingId: bookingRef.id });
//     } catch (error) {
//       res.status(500).json({ error: "Error booking slot", details: error.message });
//     }
//   };
  

//   //get slots from supplyco
//   exports.getSlotsBySupplycoId = async (req, res) => {
//     try {
//         const { supplycoId } = req.params;

//         if (!supplycoId) {
//             return res.status(400).json({ message: "Supplyco ID is required" });
//         }

//         // Reference to slots collection inside the supplyco document
//         const slotsRef = db.collection(`supplycos/${supplycoId}/slots`);
//         const snapshot = await slotsRef.get();

//         if (snapshot.empty) {
//             return res.status(404).json({ message: "No slots found for the given Supplyco ID." });
//         }

//         let slots = [];
//         snapshot.forEach(doc => {
//             slots.push({ slotId: doc.id, ...doc.data() });
//         });

//         res.status(200).json({ message: "Slots retrieved successfully", slots });

//     } catch (error) {
//         console.error("❌ Error fetching slots:", error);
//         res.status(500).json({ message: "Internal server error", error: error.message });
//     }
// };


//book a slot
exports.bookSlot = async (req, res) => {
    const { supplycoId, date, slotId, cardNumber } = req.body;

    if (!supplycoId || !date || !slotId || !cardNumber) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    const slotRef = db.collection(`supplycos/${supplycoId}/slots`).doc(slotId);
    const bookingRef = db.collection(`supplycos/${supplycoId}/bookings`).doc(date);

    try {
        const result = await db.runTransaction(async (transaction) => {
            const slotDoc = await transaction.get(slotRef);
            const bookingDoc = await transaction.get(bookingRef);

            if (!slotDoc.exists) {
                throw new Error("Slot does not exist");
            }

            const slotData = slotDoc.data();
            let bookings = bookingDoc.exists ? bookingDoc.data() : {};
            let bookedCount = bookings[slotId]?.booked_count || 0;
            let users = bookings[slotId]?.users || [];

            // Prevent duplicate booking for the same user in the same slot
            if (users.includes(cardNumber)) {
                throw new Error("You have already booked this slot");
            }

            if (bookedCount >= slotData.capacity) {
                throw new Error("Slot is full");
            }

            // Update booking count, add user, and store timestamp
            bookedCount += 1;
            users.push({ cardNumber, bookedAt: new Date().toISOString() }); // 🔥 Stores timestamp

            bookings[slotId] = { booked_count: bookedCount, users };

            transaction.set(bookingRef, bookings, { merge: true });

            return { message: "Slot booked successfully" };
        });

        res.status(200).json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};


//display slots of a supplyco
exports.getSlotsForDate = async (req, res) => {
    const { supplycoId, date } = req.params;

    if (!supplycoId || !date) {
        return res.status(400).json({ error: "Missing required parameters" });
    }

    try {
        const slotsRef = db.collection(`supplycos/${supplycoId}/slots`);
        const bookingsRef = db.collection(`supplycos/${supplycoId}/bookings`).doc(date);

        const [slotsSnapshot, bookingsSnapshot] = await Promise.all([
            slotsRef.get(),
            bookingsRef.get(),
        ]);

        let slots = [];
        let bookings = bookingsSnapshot.exists ? bookingsSnapshot.data() : {};
        const currentTime = new Date(); // 🔥 Get the current system time
        const todayDateString = currentTime.toISOString().split("T")[0]; // 🔹 Format "YYYY-MM-DD"

        slotsSnapshot.forEach((doc) => {
            let slotData = doc.data();
            let slotId = doc.id;
            let bookedCount = bookings[slotId]?.booked_count || 0;
            let capacity = slotData.capacity;
            let endTimeString = slotData.end_time; // `end_time` stored as STRING in Firestore
            let endTime = null;
            let status = "active"; // Default status

            // 🔍 Convert string `end_time` to a Date object
            if (endTimeString && typeof endTimeString === "string") {
                try {
                    const [hours, minutes] = endTimeString.split(":").map(Number);
                    const slotDate = new Date(date); // Convert `date` param to Date object
                    endTime = new Date(slotDate.getFullYear(), slotDate.getMonth(), slotDate.getDate(), hours, minutes);
                } catch (error) {
                    console.error("Invalid time format:", endTimeString);
                }
            }

            // 🔹 Determine slot status
            if (date === todayDateString && endTime && endTime < currentTime) {
                status = "expired"; // ✅ Expired if today & end_time passed
            } else if (bookedCount >= capacity) {
                status = "full"; // ✅ Mark as "full" if fully booked
            }

            slots.push({
                id: slotId,
                start_time: slotData.start_time,
                end_time: endTimeString || "N/A", // Avoid null values
                capacity,
                booked_count: bookedCount,
                status, // ✅ Properly determined slot status
            });
        });

        res.status(200).json({ message: "success", slots });
    } catch (error) {
        console.error("Error fetching slots:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};


