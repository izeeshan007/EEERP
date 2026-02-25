const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const Stock = require("./models/Stock");
const Sale = require("./models/Sale");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

mongoose.connect(process.env.MONGO_URI)
.then(()=>console.log("MongoDB Connected"))
.catch(err=>console.log(err));

/* ========= STOCK ========= */

app.post("/api/stock", async(req,res)=>{

 let s=req.body;

 if(!s.name || s.name.trim()==="")
  return res.json({success:false,message:"Name required"});

 s.pricePerUnit=
   s.size_ml>0 ? s.cost/s.size_ml :
   s.units>0 ? s.cost/s.units : 0;

 const data=await Stock.create(s);

 res.json({success:true,message:"Stock Added",data});
});

app.get("/api/stock", async(req,res)=>{
 res.json(await Stock.find().sort({_id:-1}));
});

app.put("/api/stock/:id", async(req,res)=>{

 let s=req.body;

 s.pricePerUnit =
   s.size_ml>0 ? s.cost/s.size_ml :
   s.units>0 ? s.cost/s.units : 0;

 const data=await Stock.findByIdAndUpdate(
  req.params.id,s,{new:true}
 );

 res.json({success:true,data});
});

app.delete("/api/stock/:id", async(req,res)=>{
 await Stock.findByIdAndDelete(req.params.id);
 res.json({success:true});
});

/* ========= SALES ========= */

app.post("/api/sales", async(req,res)=>{

 let s=req.body;

 s.profit=s.soldPrice-s.manufacturingCost;

 s.profitPercent =
  s.manufacturingCost>0
  ? (s.profit/s.manufacturingCost)*100
  : 0;

 const data=await Sale.create(s);

 res.json({success:true,data});
});

app.get("/api/sales", async(req,res)=>{
 res.json(await Sale.find().sort({_id:-1}));
});

app.put("/api/sales/:id", async(req,res)=>{

 let s=req.body;

 s.profit=s.soldPrice-s.manufacturingCost;

 s.profitPercent =
  s.manufacturingCost>0
  ? (s.profit/s.manufacturingCost)*100
  : 0;

 const data=await Sale.findByIdAndUpdate(
 req.params.id,s,{new:true}
 );

 res.json({success:true,data});
});

app.delete("/api/sales/:id", async(req,res)=>{
 await Sale.findByIdAndDelete(req.params.id);
 res.json({success:true});
});

/* ========= DASHBOARD ========= */

app.get("/api/dashboard", async(req,res)=>{

 const stock=await Stock.find();
 const sales=await Sale.find();

 const totalInvestment=
  stock.reduce((a,b)=>a+(b.cost||0),0);

 const totalSales=
  sales.reduce((a,b)=>a+(b.soldPrice||0),0);

 const totalProfit=
  sales.reduce((a,b)=>a+(b.profit||0),0);

 res.json({
  totalInvestment,
  totalSales,
  totalProfit,
  roi: totalInvestment ? totalSales/totalInvestment : 0
 });
});

app.listen(3000,()=>console.log("Running 3000"));