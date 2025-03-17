/* eslint-disable */

const express=require("express")
const {bookSlot,getSlotsForDate}=require("../../src/controllers/slotController")
const { authenticateUser } = require("../../src/middlewares/authMiddleware");

const router=express.Router()

router.post("/book-slot",bookSlot)
router.get("/:supplycoId/:date",getSlotsForDate)


module.exports=router