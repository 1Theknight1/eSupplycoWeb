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
        
        const currentTime = new Date();  // Current time in server timezone
        const todayDateString = currentTime.toISOString().split('T')[0];
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
                // Extract end time string
                let endTimeStr = slotData.end_time;
                let [timePart, period] = endTimeStr.split(" ");
                let [hours, minutes] = timePart.split(":").map(Number);

                // Convert to 24-hour format
                if (period === "PM" && hours !== 12) {
                    hours += 12;
                } else if (period === "AM" && hours === 12) {
                    hours = 0;
                }

                // Create a Date object for the slot's end time
                const slotDate = new Date(`${date}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`);

                // Adjust for `12:00 AM` (next day's midnight)
                if (slotData.end_time === "12:00 AM") {
                    slotDate.setDate(slotDate.getDate() + 1);
                }

                endTime = slotDate;

                // Debugging logs
                console.log(`Slot: ${slotId}, End Time: ${endTime.toISOString()}, Current Time: ${currentTime.toISOString()}`);

                // Ensure both times are in the same **timezone & format**
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

