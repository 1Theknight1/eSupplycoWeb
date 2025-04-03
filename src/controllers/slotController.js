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
        
        const currentTime = new Date();
        const todayDateString = currentTime.toISOString().split('T')[0];
        const isToday = date === todayDateString;
        
        const slots = [];
        const bookings = bookingsSnapshot.exists ? bookingsSnapshot.data() : {};

        slotsSnapshot.forEach((doc) => {
            const slotData = doc.data();
            const slotId = doc.id;
            const bookedCount = bookings[slotId]?.booked_count || 0;
            const capacity = slotData.capacity;
            
            // Parse the end time
            let endTime = null;
            let status = "active";
            
            try {
                // Convert time strings to 24-hour format first
                let endTimeStr = slotData.end_time;
                if (endTimeStr.includes("AM") || endTimeStr.includes("PM")) {
                    const timeFormat = new Intl.DateTimeFormat('en', {
                        hour: 'numeric',
                        minute: 'numeric',
                        hour12: true
                    });
                    const date = new Date();
                    date.setHours(12); // Set to noon to avoid AM/PM confusion
                    const parsed = timeFormat.formatToParts(date);
                    // This is just to get the format - actual parsing needs to be done
                    // For actual parsing, use a library like moment or date-fns
                    endTimeStr = endTimeStr.replace(" AM", "").replace(" PM", "");
                }
                
                const [hours, minutes] = endTimeStr.split(':').map(Number);
                const slotDate = new Date(date);
                endTime = new Date(
                    slotDate.getFullYear(),
                    slotDate.getMonth(),
                    slotDate.getDate(),
                    hours,
                    minutes
                );

                // Fix PM times (add 12 hours except for 12 PM)
                if (slotData.end_time.includes("PM") && hours !== 12) {
                    endTime.setHours(endTime.getHours() + 12);
                }
                // Fix 12 AM (midnight)
                if (slotData.end_time.includes("AM") && hours === 12) {
                    endTime.setHours(0);
                }

                // Determine status
                if (isToday && endTime < currentTime) {
                    status = "expired";
                } else if (bookedCount >= capacity) {
                    status = "full";
                }
            } catch (error) {
                console.error("Error parsing time:", error);
                // Default to active if time parsing fails
                status = "active";
            }

            slots.push({
                id: slotId,
                start_time: slotData.start_time,
                end_time: slotData.end_time,
                capacity,
                booked_count: bookedCount,
                status, // Now properly calculated
            });
        });

        res.status(200).json({ message: "success", slots });
    } catch (error) {
        console.error("Error fetching slots:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};
