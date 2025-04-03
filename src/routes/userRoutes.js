/* eslint-disable */
const express=require("express")
const {getPhoneNumber,getAllSupplycos, getSupplycosByTaluk,getUserProfile}=require("../../src/controllers/userController")

const router=express.Router();

router.post("/getPhoneNumber",getPhoneNumber)
router.get("/supplycos",getAllSupplycos)
router.get("/searchSupplyco",getSupplycosByTaluk)
router.get("/getDetails/:cardNumber",getUserProfile)
// router.post("/sendFeedBack",sendFeedBack)

module.exports=router