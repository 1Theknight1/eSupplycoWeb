/* eslint-disable */

const express=require("express")
const {supplycoBasedProducts,searchProduct,calcDiscount}=require("../controllers/productsControllers");
const { authenticateUser } = require("../middlewares/authMiddleware");

const router=express.Router()

router.get("/display/:supplycoId",supplycoBasedProducts);
router.get("/searchProduct",searchProduct);
router.post("/calculate-quota",calcDiscount);



module.exports=router