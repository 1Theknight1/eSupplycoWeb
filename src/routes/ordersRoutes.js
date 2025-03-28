/* eslint-disable */

const express=require("express");
const {placeOrder,calculateDiscount,getOrdersByNumber,cancelOrder,getActiveOrdersByNumber,getHistory,changeOrderStatue,assignDelivery,outForDelivery}=require("../../src/controllers/ordersController");
const{authenticateUser}=require("../../src/middlewares/authMiddleware");
const router=express.Router();

router.post("/orders",placeOrder);
router.get("/:cardNumber",getOrdersByNumber);
router.post("/calculate-discount",authenticateUser,calculateDiscount);
router.get("/cancelOrder/:orderId",authenticateUser,cancelOrder);
router.get("/activeOrders/:cardNumber",getActiveOrdersByNumber);
router.get("/bookings/:cardNumber",getHistory);
router.patch("/status/:orderId",changeOrderStatue);
router.post("/assignDelivery",assignDelivery);
//router.post("/changeDeliveryOrderStatus",outForDelivery);
router.post("/changeDeliveryOrderStatus",updateOutForDelivery);

module.exports=router