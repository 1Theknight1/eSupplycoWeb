/* eslint-disable */

const express=require("express")
const {productsAdd,supplycoAll,deleteUser,sendMessage,setReminder,setQuota,staffRequests,staffUpdateStatus,adminDashboard,addPrimaryAdmin,getAllLogs}=require("../../src/controllers/adminController")
const {authenticateUser}=require("../../src/middlewares/authMiddleware")

const router=express.Router()

router.post("/products/add",productsAdd)
router.get("/supplyco/all",supplycoAll)
router.post("/userDel",deleteUser)
router.post("/send",sendMessage)
router.post("/set-reminder",setReminder)
router.post("/set-quota",setQuota)
router.get("/staff-requests",staffRequests)
router.put("/updateStatus",staffUpdateStatus)
router.get("/adminDashboard",adminDashboard)
router.post("/addPrimaryAdmin",addPrimaryAdmin)
router.get("/getAllLogs",getAllLogs)

module.exports=router