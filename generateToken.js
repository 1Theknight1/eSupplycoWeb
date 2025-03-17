const admin = require("firebase-admin");

// Replace with the device FCM token from your Flutter app
const deviceToken = "fVmwZGOLS8iWNhkqpWc5Sh:APA91bFFmbPuxCa796QJhmXHVRVpQaUvGh6My0mVy5khJOWV_fNzc1VYdDQWiwD48JzC62lw68tr85yPvnZt-9YqfH0F54R0y0cxsIcu44CO_Fw9gVW8XWQ";

async function sendNotification() {
  const message = {
    token: deviceToken, // Send to specific device
    notification: {
      title: "🔥 Background Notification",
      body: "This will appear even when the app is closed.",
    },
    android: {
      priority: "high",
      notification: {
        channelId: "high_importance_channel",
        sound: "default",
      },
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
        },
      },
    },
  };

  try {
    const response = await admin.messaging().send(message);
    console.log("✅ Notification sent successfully:", response);
  } catch (error) {
    console.error("❌ Error sending notification:", error);
  }
}

// Call the function
sendNotification();

