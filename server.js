const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();
const session = require("express-session");
const https = require('https');

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

/* ================= KEEP ALIVE PING ================= */
// Prevents Render free tier from going to sleep after 15 mins of inactivity.
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
if (RENDER_URL) {
    setInterval(() => {
        https.get(RENDER_URL + '/api/check-auth').on('error', (err) => {
            console.error('Keep-alive ping failed:', err.message);
        });
    }, 14 * 60 * 1000); 
}

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
 
 // Deduct liquid volume from Finished Batch Stock if used
 if (s.isFromBatch && s.sourceBatchId) {
     const batch = await Stock.findById(s.sourceBatchId);
     if (batch && batch.size_ml > 0) {
         const deductVolume = s.size_ml * (s.units || 1);
         batch.size_ml -= deductVolume;
         
         if (batch.size_ml < 0) batch.size_ml = 0;
         
         batch.cost = batch.size_ml * (batch.pricePerUnit || 0);

         if (batch.size_ml <= 0) {
             batch.status = "Dead Stock";
         }
         await batch.save();
     }
 }

 s.profit = s.soldPrice - (s.discount || 0) - (s.distributorMargin || 0) - s.manufacturingCost;
 s.profitPercent = s.manufacturingCost > 0 ? (s.profit / s.manufacturingCost) * 100 : 0;

 const data=await Sale.create(s);
 res.json({success:true,data});
});

app.get("/api/sales", requireAuth, async(req,res)=>{
 res.json(await Sale.find().sort({_id:-1}));
});

// UPDATED: Handle editing a sale and reverting/re-deducting stock
app.put("/api/sales/:id", requireAuth, async(req,res)=>{
 let s=req.body;
 
 const oldSale = await Sale.findById(req.params.id);
 if (!oldSale) return res.status(404).json({success: false, message: "Sale not found"});

 // 1. REVERT old stock deduction
 if (oldSale.isFromBatch && oldSale.sourceBatchId) {
     const oldBatch = await Stock.findById(oldSale.sourceBatchId);
     if (oldBatch) {
         oldBatch.size_ml += (oldSale.size_ml * (oldSale.units || 1));
         oldBatch.cost = oldBatch.size_ml * (oldBatch.pricePerUnit || 0);
         // If it was dead stock, and we gave volume back, reactivate it
         if (oldBatch.size_ml > 0 && oldBatch.status === "Dead Stock") {
             oldBatch.status = "Active";
         }
         await oldBatch.save();
     }
 }

 // Maintain batch tracking variables from the database if the UI didn't send them
 if (s.isFromBatch === undefined) s.isFromBatch = oldSale.isFromBatch;
 if (s.sourceBatchId === undefined) s.sourceBatchId = oldSale.sourceBatchId;

 // 2. APPLY new stock deduction based on edits
 if (s.isFromBatch && s.sourceBatchId) {
     const newBatch = await Stock.findById(s.sourceBatchId);
     if (newBatch) {
         const deductVolume = s.size_ml * (s.units || 1);
         newBatch.size_ml -= deductVolume;
         
         if (newBatch.size_ml < 0) newBatch.size_ml = 0;
         
         newBatch.cost = newBatch.size_ml * (newBatch.pricePerUnit || 0);
         if (newBatch.size_ml <= 0) {
             newBatch.status = "Dead Stock";
         }
         await newBatch.save();
     }
 }

 s.profit = s.soldPrice - (s.discount || 0) - (s.distributorMargin || 0) - s.manufacturingCost;
 s.profitPercent = s.manufacturingCost > 0 ? (s.profit / s.manufacturingCost) * 100 : 0;

 const data=await Sale.findByIdAndUpdate(
   req.params.id,s,{new:true}
 );
 res.json({success:true,data});
});

// UPDATED: Handle deleting a sale completely and restoring the liquid to the batch
app.delete("/api/sales/:id", requireAuth, async(req,res)=>{
 const sale = await Sale.findById(req.params.id);
 
 // If this sale came from a batch, put the liquid back before deleting the record
 if (sale && sale.isFromBatch && sale.sourceBatchId) {
     const batch = await Stock.findById(sale.sourceBatchId);
     if (batch) {
         batch.size_ml += (sale.size_ml * (sale.units || 1));
         batch.cost = batch.size_ml * (batch.pricePerUnit || 0);
         
         if (batch.size_ml > 0 && batch.status === "Dead Stock") {
             batch.status = "Active";
         }
         await batch.save();
     }
 }

 await Sale.findByIdAndDelete(req.params.id);
 res.json({success:true});
});

/* ================= INVOICES ================= */

app.post("/api/sales/merge", requireAuth, async(req,res)=>{
  const { ids } = req.body;
  if (!ids || !ids.length) return res.json({success:false});
  
  const date = new Date();
  const dateStr = date.toISOString().slice(0,10).replace(/-/g,"");
  const rand = Math.floor(1000 + Math.random() * 9000);
  const invoiceNumber = `INV-${dateStr}-${rand}`;

  await Sale.updateMany({ _id: { $in: ids } }, { $set: { invoiceNumber, revisionCount: 0 } });
  res.json({ success: true, invoiceNumber });
});

app.post("/api/sales/add-to-invoice", requireAuth, async(req,res)=>{
    const { ids, invoiceNumber } = req.body;
    if (!ids || !ids.length || !invoiceNumber) return res.json({success:false});
    
    const existingItem = await Sale.findOne({ invoiceNumber });
    const newRevision = existingItem ? (existingItem.revisionCount || 0) + 1 : 1;
    
    await Sale.updateMany({ _id: { $in: ids } }, { 
        $set: { 
            invoiceNumber,
            invoiceDiscount: existingItem ? existingItem.invoiceDiscount : 0,
            cgstPercent: existingItem ? existingItem.cgstPercent : 0,
            sgstPercent: existingItem ? existingItem.sgstPercent : 0,
            igstPercent: existingItem ? existingItem.igstPercent : 0,
            customerAddress: existingItem ? existingItem.customerAddress : "",
            customerPhone: existingItem ? existingItem.customerPhone : "",
            revisionCount: newRevision
        } 
    });
    
    await Sale.updateMany({ invoiceNumber, _id: { $nin: ids } }, { $set: { revisionCount: newRevision } });
    
    recalculateInvoiceDiscount(invoiceNumber);
    res.json({ success: true });
});

app.post("/api/sales/remove-from-invoice", requireAuth, async(req,res)=>{
    const { id } = req.body;
    const sale = await Sale.findById(id);
    if (!sale) return res.json({success:false});
    
    const invNum = sale.invoiceNumber;
    
    sale.invoiceNumber = null;
    sale.invoiceDiscount = 0;
    sale.discount = 0;
    sale.profit = sale.soldPrice - (sale.distributorMargin || 0) - sale.manufacturingCost;
    sale.cgstPercent = 0;
    sale.sgstPercent = 0;
    sale.igstPercent = 0;
    sale.customerAddress = "";
    sale.customerPhone = "";
    sale.revisionCount = 0;
    await sale.save();
    
    if(invNum) {
        const remaining = await Sale.findOne({ invoiceNumber: invNum });
        if(remaining) {
            const newRev = (remaining.revisionCount || 0) + 1;
            await Sale.updateMany({ invoiceNumber: invNum }, { $set: { revisionCount: newRev } });
            recalculateInvoiceDiscount(invNum);
        }
    }
    
    res.json({ success: true });
});

app.put("/api/invoices/:invoiceNumber", requireAuth, async(req,res)=>{
  const { invoiceDiscount, cgstPercent, sgstPercent, igstPercent, customerAddress, customerPhone } = req.body;
  
  const existing = await Sale.findOne({ invoiceNumber: req.params.invoiceNumber });
  const newRev = existing ? (existing.revisionCount || 0) + 1 : 1;
  
  await Sale.updateMany(
      { invoiceNumber: req.params.invoiceNumber },
      { $set: { invoiceDiscount, cgstPercent, sgstPercent, igstPercent, customerAddress, customerPhone, revisionCount: newRev } }
  );
  
  recalculateInvoiceDiscount(req.params.invoiceNumber);
  res.json({ success: true });
});

app.delete("/api/invoices/:invoiceNumber", requireAuth, async(req,res)=>{
    const invNum = req.params.invoiceNumber;
    if(!invNum) return res.json({success:false});
    
    const items = await Sale.find({ invoiceNumber: invNum });
    for (const sale of items) {
        sale.invoiceNumber = null;
        sale.invoiceDiscount = 0;
        sale.discount = 0;
        sale.profit = sale.soldPrice - (sale.distributorMargin || 0) - sale.manufacturingCost;
        sale.cgstPercent = 0;
        sale.sgstPercent = 0;
        sale.igstPercent = 0;
        sale.customerAddress = "";
        sale.customerPhone = "";
        sale.revisionCount = 0;
        await sale.save();
    }
    
    res.json({ success: true });
});

async function recalculateInvoiceDiscount(invoiceNumber) {
    const items = await Sale.find({ invoiceNumber });
    if(items.length === 0) return;
    
    const subTotal = items.reduce((sum, item) => sum + (item.soldPrice || 0), 0);
    const invoiceDiscount = items[0].invoiceDiscount || 0; 

    for (const item of items) {
        const itemDiscount = subTotal > 0 ? (item.soldPrice / subTotal) * invoiceDiscount : 0;
        const newProfit = item.soldPrice - itemDiscount - (item.distributorMargin || 0) - item.manufacturingCost;

        await Sale.findByIdAndUpdate(item._id, {
            discount: itemDiscount,
            profit: newProfit
        });
    }
}

/* ================= DASHBOARD ================= */

app.get("/api/dashboard", requireAuth, async(req,res)=>{
 const stock=await Stock.find();
 const sales=await Sale.find();

 const totalInvestment = stock.reduce((a,b)=>a+(b.cost||0),0);
 
 const deadStockCost = stock.filter(s => s.status !== "Active").reduce((a,b)=>a+(b.cost||0), 0);

 const totalSales = sales.reduce((a,b)=>a+((b.soldPrice||0) - (b.discount||0) - (b.distributorMargin||0)),0);
 
 const rawProfit = sales.reduce((a,b)=>a+(b.profit||0),0);
 const totalProfit = rawProfit - deadStockCost;

 res.json({
  totalInvestment,
  totalSales,
  totalProfit,
  roi: totalInvestment ? totalProfit/totalInvestment : 0
 });
});

app.listen(3000,()=>console.log("Running 3000"));