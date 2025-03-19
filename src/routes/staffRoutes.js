/* eslint-disable */

const express=require("express")
const{getSupplycoOrders,staffRegister,staffLogin,addSlot,getAllSlotsForSUpplyco}=require("../../src/controllers/staffController")
const router=express.Router()

router.get("/orders/supplyco/:supplycoId",getSupplycoOrders)
router.post("/staff-register",staffRegister)
router.post("/staff-login",staffLogin)
router.post("/addSlot/:supplycoId",addSlot)
router.get("/bookings/:supplycoId",getAllSlotsForSUpplyco)

module.exports=router