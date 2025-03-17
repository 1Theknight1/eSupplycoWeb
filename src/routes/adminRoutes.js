/* eslint-disable */

const express=require("express")
const {productsAdd,supplycoAdd,supplycoAll,deleteUser,sendMessage,setReminder,setQuota,getStaffRequest}=require("../../src/controllers/adminController")
const {authenticateUser}=require("../../src/middlewares/authMiddleware")

const router=express.Router()

router.post("/products/add",productsAdd)
router.post("/supplyco/add",supplycoAdd)
router.get("/supplyco/all",supplycoAll)
router.post("/userDel",deleteUser)
router.post("/send",sendMessage)
router.post("/set-reminder",setReminder)
router.post("/set-quota",setQuota)
router.get("/staff-requests",getStaffRequest)

module.exports=router