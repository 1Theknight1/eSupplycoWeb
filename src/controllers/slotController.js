/* eslint-disable */

const {db,rtdb}=require("../utils/firebase-config")
const admin=require("firebase-admin")


async function logApiCall( action) {
  const logRef = db.collection("logs").doc();
  await logRef.set({
   
    action: action, // Custom action description
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log("saved slot log");
}

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
        await logApiCall(`${cardNumber} booked ${slotId} at ${supplycoId}` );
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


