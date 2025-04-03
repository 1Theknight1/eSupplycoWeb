/* eslint-disable */

const express=require("express")
const{getSupplycoOrders,staffRegister,staffLogin,addSlot,getAllSlotsForSUpplyco,getSupplycoDetails,getSlotByCardNumber,checkPickup,updateStock,registerDeliveryBoy,getDeliveryRequestsBySupplyco,updateDeliveryRequestStatus,getDeliveryBySupplyco,getDeliveryBoyDetails,getAllFeedback}=require("../../src/controllers/staffController")
const router=express.Router()

router.get("/orders/supplyco/:supplycoId",getSupplycoOrders)
router.post("/staff-register",staffRegister)
router.post("/staff-login",staffLogin)
router.post("/addSlot/:supplycoId",addSlot)
router.get("/bookings/:supplycoId",getAllSlotsForSUpplyco)
router.get("/:supplycoId",getSupplycoDetails)
router.post("/getSlotByCardNumber",getSlotByCardNumber)
router.post("/check-order",checkPickup)
router.post("/update-stock",updateStock)
router.post("/registerDeliveryBoy",registerDeliveryBoy)
router.get("/delivery/request/:supplycoId",getDeliveryRequestsBySupplyco)
router.patch("/delivery/request/status/:requestId",updateDeliveryRequestStatus)
router.get("/getDelivery/:supplycoId",getDeliveryBySupplyco)
router.get("/getDeliveryBoy/:deliveryBoyId",getDeliveryBoyDetails)
router.get("/getAllFeedBack/:supplycoId",getAllFeedback)

module.exports=router