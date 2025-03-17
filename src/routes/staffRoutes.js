/* eslint-disable */

const express=require("express")
const{getSupplycoOrders,staffRegister,staffLogin}=require("../../src/controllers/staffController")
const router=express.Router()

router.get("/orders/supplyco/:supplycoId",getSupplycoOrders)
router.post("/staff-register",staffRegister)
router.post("/staff-login",staffLogin)

module.exports=router