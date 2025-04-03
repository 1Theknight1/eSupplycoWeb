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

    try {
        const slotsSnapshot = await db.collection(`supplycos/${supplycoId}/slots`).get();
        const bookingsSnapshot = await db.collection(`supplycos/${supplycoId}/bookings`).doc(date).get();

        // Get current time (local timezone) for accurate comparison
        const currentTime = new Date();
        const todayDateString = new Date().toISOString().split('T')[0];
        const isToday = date === todayDateString;

        const slots = [];
        const bookings = bookingsSnapshot.exists ? bookingsSnapshot.data() : {};

        slotsSnapshot.forEach((doc) => {
            const slotData = doc.data();
            const slotId = doc.id;
            const bookedCount = bookings[slotId]?.booked_count || 0;
            const capacity = slotData.capacity;

            let endTime = null;
            let status = "active";

            try {
                // Extract hours and minutes from end_time
                let endTimeStr = slotData.end_time.trim();

                // Check if AM/PM is missing and assume 24-hour format if necessary
                let is24HourFormat = !endTimeStr.includes("AM") && !endTimeStr.includes("PM");
                let period = endTimeStr.includes("AM") ? "AM" : (endTimeStr.includes("PM") ? "PM" : "");

                // Remove AM/PM and split into hours and minutes
                let [hours, minutes] = endTimeStr.replace(" AM", "").replace(" PM", "").split(":").map(Number);

                // Convert to 24-hour format correctly
                if (!is24HourFormat) {
                    if (period === "PM" && hours !== 12) {
                        hours += 12;
                    } else if (period === "AM" && hours === 12) {
                        hours = 0;
                    }
                }

                // Create Date object for slot's end time
                endTime = new Date(date);
                endTime.setHours(hours, minutes, 0, 0); // Set hours and minutes

                console.log(`Slot: ${slotId}, End Time: ${endTime.toISOString()}, Current Time: ${currentTime.toISOString()}`);

                // Compare timestamps correctly
                if (isToday && endTime.getTime() <= currentTime.getTime()) {
                    status = "expired";
                } else if (bookedCount >= capacity) {
                    status = "full";
                }
            } catch (error) {
                console.error("Error parsing time:", error);
                status = "active"; // Default to active if parsing fails
            }

            slots.push({
                id: slotId,
                start_time: slotData.start_time,
                end_time: slotData.end_time,
                capacity,
                booked_count: bookedCount,
                status, 
            });
        });

        res.status(200).json({ message: "success", slots });
    } catch (error) {
        console.error("Error fetching slots:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};


