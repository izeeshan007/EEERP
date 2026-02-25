const mongoose = require("mongoose");

const StockSchema = new mongoose.Schema({

 category:String,
 subCategory:String,
 type:String,

 name:String,
 designerName:String,
 supplier:String,

 size_ml:Number,
 units:Number,

 cost:Number,
 pricePerUnit:Number,

 purchaseDate:{
  type:Date,
  default:Date.now
 }

});

module.exports = mongoose.model("Stock", StockSchema);