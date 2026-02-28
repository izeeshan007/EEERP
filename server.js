const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();
const session = require("express-session");

const Stock = require("./models/Stock");
const Sale = require("./models/Sale");

const app = express();

app.use(cors());
app.use(express.json());

app.use(session({
 secret: process.env.SESSION_SECRET,
 resave: false,
 saveUninitialized: false,
 cookie: { secure: false }
}));

/* ================= DATABASE ================= */

mongoose.connect(process.env.MONGO_URI)
.then(()=>console.log("MongoDB Connected"))
.catch(err=>console.log(err));

/* ================= AUTH ROUTES ================= */

app.post("/api/login", (req,res)=>{
 const { username, password } = req.body;
 if(
  username === process.env.ADMIN_USER &&
  password === process.env.ADMIN_PASS
 ){
  req.session.authenticated = true;
  return res.json({success:true});
 }
 res.json({success:false, message:"Invalid credentials"});
});

app.get("/api/check-auth",(req,res)=>{
 res.json({authenticated: !!req.session.authenticated});
});

app.post("/api/logout",(req,res)=>{
 req.session.destroy(()=>{
  res.json({success:true});
 });
});

/* ================= AUTH MIDDLEWARE ================= */

function requireAuth(req,res,next){
 if(req.session.authenticated){
  next();
 }else{
  res.status(401).json({message:"Unauthorized"});
 }
}

/* ================= PROTECT FRONTEND ================= */

app.get("/",(req,res)=>{
 if(req.session.authenticated){
  res.sendFile(__dirname + "/public/index.html");
 }else{
  res.redirect("/login.html");
 }
});

app.use(express.static("public"));

/* ================= STOCK ================= */

app.post("/api/stock", requireAuth, async(req,res)=>{
 let s=req.body;
 if(!s.name || s.name.trim()==="")
  return res.json({success:false,message:"Name required"});

 s.pricePerUnit =
   s.size_ml>0 ? s.cost/s.size_ml :
   s.units>0 ? s.cost/s.units : 0;

 const data=await Stock.create(s);
 res.json({success:true,message:"Stock Added",data});
});

app.get("/api/stock", requireAuth, async(req,res)=>{
 res.json(await Stock.find().sort({_id:-1}));
});

app.put("/api/stock/:id", requireAuth, async(req,res)=>{
 let s=req.body;
 s.pricePerUnit =
   s.size_ml>0 ? s.cost/s.size_ml :
   s.units>0 ? s.cost/s.units : 0;

 const data=await Stock.findByIdAndUpdate(
  req.params.id,s,{new:true}
 );
 res.json({success:true,data});
});

app.delete("/api/stock/:id", requireAuth, async(req,res)=>{
 await Stock.findByIdAndDelete(req.params.id);
 res.json({success:true});
});

/* ================= SALES ================= */

app.post("/api/sales", requireAuth, async(req,res)=>{
 let s=req.body;
 s.profit=s.soldPrice-s.manufacturingCost;
 s.profitPercent =
  s.manufacturingCost>0
  ? (s.profit/s.manufacturingCost)*100
  : 0;

 const data=await Sale.create(s);
 res.json({success:true,data});
});

app.get("/api/sales", requireAuth, async(req,res)=>{
 res.json(await Sale.find().sort({_id:-1}));
});

app.put("/api/sales/:id", requireAuth, async(req,res)=>{
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

app.delete("/api/sales/:id", requireAuth, async(req,res)=>{
 await Sale.findByIdAndDelete(req.params.id);
 res.json({success:true});
});

// NEW: Merge Sales into an Invoice
app.post("/api/sales/merge", requireAuth, async(req,res)=>{
  const { ids } = req.body;
  if (!ids || !ids.length) return res.json({success:false});
  
  // Auto Generate Professional Invoice Number (e.g., INV-YYYYMMDD-XXXX)
  const date = new Date();
  const dateStr = date.toISOString().slice(0,10).replace(/-/g,"");
  const rand = Math.floor(1000 + Math.random() * 9000);
  const invoiceNumber = `INV-${dateStr}-${rand}`;

  await Sale.updateMany({ _id: { $in: ids } }, { $set: { invoiceNumber } });
  res.json({ success: true, invoiceNumber });
});

/* ================= DASHBOARD ================= */

app.get("/api/dashboard", requireAuth, async(req,res)=>{
 const stock=await Stock.find();
 const sales=await Sale.find();

 const totalInvestment = stock.reduce((a,b)=>a+(b.cost||0),0);
 const totalSales = sales.reduce((a,b)=>a+(b.soldPrice||0),0);
 const totalProfit = sales.reduce((a,b)=>a+(b.profit||0),0);

 res.json({
  totalInvestment,
  totalSales,
  totalProfit,
  roi: totalInvestment ? totalSales/totalInvestment : 0
 });
});

app.listen(3000,()=>console.log("Running 3000"));