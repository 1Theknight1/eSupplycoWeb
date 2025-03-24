const admin = require("firebase-admin");

// Initialize Firebase Admin SDK (ensure service account is correct)
admin.initializeApp({
  credential: admin.credential.cert(require("./key.json")),
});

const fcm = admin.messaging();

async function sendTestNotification() {
  const message = {
    token: "fCmBumPpQ-u8T4ber1Eoc8:APA91bFO4tA6E7_Qysyng-STr4BfwVarC-SLQup5SLcvBsj_HqGeGCykeVDUtaIzX56yZSsrsqKwuA_nqKzDloZDrLTouSHiA6g5K8ev9Td9l43GErkoQSU", // Replace with a real token
    notification: {
      title: "Test Notification",
      body: "This is a test message from Firebase Cloud Messaging!",
    },
  };

  try {
    const response = await fcm.send(message);
    console.log("✅ Message sent successfully:", response);
  } catch (error) {
    console.error("❌ Error sending message:", error);
  }
}

sendTestNotification();
