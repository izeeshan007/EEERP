const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();
const session = require("express-session");
const MongoStore = require("connect-mongo");
const dns = require("dns").promises;
const { execFile } = require("child_process");
const { promisify } = require("util");

const Stock = require("./models/Stock");
const Sale = require("./models/Sale");
const Dealer = require("./models/Dealer");

const app = express();
const execFileAsync = promisify(execFile);
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production" || process.env.RENDER === "true";
const sessionSecret = String(process.env.SESSION_SECRET || (isProduction ? "" : "eeerp-local-session-secret-change-me"));

if (!sessionSecret) {
 console.error("EEERP configuration error: SESSION_SECRET is required in production.");
}

mongoose.set("bufferCommands", false);

const allowedOrigins = String(process.env.FRONTEND_URLS || process.env.FRONTEND_URL || "")
 .split(",")
 .map(value => value.trim().replace(/\/$/, ""))
 .filter(Boolean);
allowedOrigins.push("http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:5173", "http://127.0.0.1:5173");
app.use(cors({
 origin(origin, callback) {
 if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ""))) return callback(null, true);
  if (/^http:\/\/(localhost|127\.0\.0\.1):\d+$/i.test(origin)) return callback(null, true);
  return callback(new Error(`CORS blocked: ${origin}`));
 },
 credentials: true
}));
app.use(express.json());

if (isProduction) app.set("trust proxy", 1);

const sessionMongoUri = String(process.env.MONGO_DIRECT_URI || process.env.MONGO_URI || "").trim();
let productionSessionStore;
if (isProduction && sessionMongoUri) {
 productionSessionStore = MongoStore.create({
  mongoUrl: sessionMongoUri,
  collectionName: "eeerp_sessions",
  ttl: 60 * 60 * 12,
  autoRemove: "native",
  touchAfter: 60 * 60
 });
 productionSessionStore.on("error", error => {
  console.error("EEERP session store error:", error);
 });
}

app.use(session({
 // Keep the middleware operational long enough to return a useful JSON
 // configuration error instead of Express' HTML 500 page.
 secret: sessionSecret || "eeerp-invalid-production-configuration",
 store: productionSessionStore,
 resave: false,
 saveUninitialized: false,
 cookie: {
  secure: isProduction,
  sameSite: "lax",
  httpOnly: true,
  maxAge: 1000 * 60 * 60 * 12
 }
}));

app.use((req, res, next) => {
 if (!sessionSecret && req.path.startsWith("/api/")) {
  return res.status(503).json({ success: false, message: "EEERP is missing SESSION_SECRET in its Render environment." });
 }
 next();
});

/* ================= DATABASE ================= */

let databaseState = "connecting";
let databaseError = "";

function safeMongoPreview(uri) {
 return String(uri || "").replace(/(mongodb(?:\+srv)?:\/\/[^:]+:)[^@]+@/i, "$1[REDACTED]@");
}

async function windowsSrvFallback(rawUri) {
 const parsed = new URL(rawUri);
 const host = parsed.hostname;
 if (!/^[a-z0-9.-]+$/i.test(host)) throw new Error("Invalid MongoDB SRV hostname");

 try {
  await dns.resolveSrv(`_mongodb._tcp.${host}`);
  return rawUri;
 } catch (nodeDnsError) {
  if (process.platform !== "win32") throw nodeDnsError;
  console.warn("Node SRV lookup failed; trying the Windows DNS resolver.");
 }

 const script = [
  `$records = Resolve-DnsName -Type SRV -Name '_mongodb._tcp.${host}' -ErrorAction Stop`,
  `$txt = Resolve-DnsName -Type TXT -Name '${host}' -ErrorAction SilentlyContinue`,
  `$payload = [PSCustomObject]@{ hosts = @($records | ForEach-Object { \"$($_.NameTarget.TrimEnd('.')):$($_.Port)\" }); txt = (($txt.Strings -join '') -replace '^mongodb\\.','') }`,
  `$payload | ConvertTo-Json -Compress`
 ].join("; ");
 const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 15000 });
 const resolved = JSON.parse(stdout.trim());
 if (!Array.isArray(resolved.hosts) || !resolved.hosts.length) throw new Error("Windows DNS returned no MongoDB hosts");

 const credentials = parsed.username
  ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ""}@`
  : "";
 const databasePath = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "/";
 const options = new URLSearchParams(parsed.searchParams);
 options.set("tls", "true");
 for (const part of String(resolved.txt || "").split("&")) {
  const [key, value] = part.split("=");
  if (key && value && !options.has(key)) options.set(key, value);
 }
 return `mongodb://${credentials}${resolved.hosts.join(",")}${databasePath}?${options.toString()}`;
}

async function resolveMongoUri() {
 const rawUri = String(process.env.MONGO_DIRECT_URI || process.env.MONGO_URI || "").trim();
 if (!rawUri) throw new Error("MONGO_URI is not configured");
 if (!/^mongodb(?:\+srv)?:\/\//i.test(rawUri)) throw new Error("MONGO_URI must start with mongodb:// or mongodb+srv://");
 return rawUri.startsWith("mongodb+srv://") ? windowsSrvFallback(rawUri) : rawUri;
}

async function connectDatabase() {
 while (mongoose.connection.readyState !== 1) {
  try {
   databaseState = "connecting";
   const uri = await resolveMongoUri();
   console.log("Connecting to MongoDB:", safeMongoPreview(uri));
   await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
   databaseState = "connected";
   databaseError = "";
   console.log("MongoDB Connected");
   await backfillFinanceFields();
   return;
  } catch (error) {
   databaseState = "disconnected";
   databaseError = error.message || String(error);
   console.error("MongoDB unavailable:", databaseError);
   await new Promise(resolve => setTimeout(resolve, 5000));
  }
 }
}

mongoose.connection.on("disconnected", () => { databaseState = "disconnected"; });

function requireDatabase(req, res, next) {
 if (mongoose.connection.readyState === 1) return next();
 return res.status(503).json({
  success: false,
  message: "EEERP database is temporarily unavailable. The server is retrying the connection.",
  database: databaseState
 });
}

app.get("/api/health", (req, res) => {
 const connected = mongoose.connection.readyState === 1;
 res.status(connected ? 200 : 503).json({
  success: connected,
  service: "eeerp",
  port: PORT,
  database: databaseState,
  error: connected ? undefined : databaseError
 });
});

app.use(["/api/stock", "/api/sales", "/api/invoices", "/api/dashboard", "/api/dealers", "/api/customers", "/api/receivables", "/api/dealer-finances", "/api/acquisition-analytics"], requireDatabase);
app.use("/api/integrations", requireDatabase);

/* ================= FINANCE HELPERS ================= */

const money = value => Math.round((Number(value) || 0) * 100) / 100;
const isAcquisitionSale = sale => Boolean(sale?.isAcquisitionCost) || Number(sale?.soldPrice || 0) === 0;
const normalizeParty = value => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");

function saleReceivableTotal(sale) {
 const taxable = Math.max(0, Number(sale.soldPrice || 0) - Number(sale.discount || 0));
 const taxPercent = Number(sale.cgstPercent || 0) + Number(sale.sgstPercent || 0) + Number(sale.igstPercent || 0);
 return money(taxable + (taxable * taxPercent / 100) + Number(sale.shippingCharge || 0));
}

function acquisitionExpense(sale) {
 return money(Math.max(0,
  Number(sale.manufacturingCost || 0) +
  Number(sale.distributorMargin || 0)
 ));
}

function derivePaymentStatus(received, total, acquisition = false) {
 if (acquisition || total <= 0) return "NOT_APPLICABLE";
 if (received <= 0) return "UNPAID";
 if (received + 0.009 >= total) return "PAID";
 return "PARTIAL";
}

function prepareSaleAccounting(input, previous = null) {
 const sale = input;
 if (sale.customerName === undefined && previous) sale.customerName = previous.customerName;
 if (sale.dealerId === undefined && previous) sale.dealerId = previous.dealerId;
 sale.soldPrice = Number(sale.soldPrice || 0);
 sale.manufacturingCost = Number(sale.manufacturingCost || 0);
 sale.distributorMargin = Number(sale.distributorMargin || 0);
 sale.discount = Number(sale.discount || 0);
 sale.units = Math.max(1, Number(sale.units || 1));
 sale.isAcquisitionCost = sale.isAcquisitionCost === undefined
  ? Boolean(previous?.isAcquisitionCost) || sale.soldPrice === 0
  : Boolean(sale.isAcquisitionCost) || sale.soldPrice === 0;
 if (sale.isAcquisitionCost) {
  sale.soldPrice = 0;
  sale.acquisitionType = sale.acquisitionType || "sample";
 }
 sale.counterpartyType = (sale.counterpartyType || previous?.counterpartyType) === "dealer" ? "dealer" : "customer";
 sale.counterpartyKey = sale.dealerId
  ? `dealer:${sale.dealerId}`
  : `${sale.counterpartyType}:${normalizeParty(sale.customerName)}`;
 sale.profit = sale.soldPrice - sale.discount - sale.distributorMargin - sale.manufacturingCost;
 sale.profitPercent = sale.manufacturingCost > 0 ? (sale.profit / sale.manufacturingCost) * 100 : 0;

 const total = saleReceivableTotal(sale);
 if (sale.isAcquisitionCost) {
  sale.amountReceived = 0;
 } else if (sale.amountReceived !== undefined) {
  sale.amountReceived = Math.min(total, Math.max(0, Number(sale.amountReceived || 0)));
 } else if (sale.isPaid === true) {
  sale.amountReceived = total;
 } else if (previous?.isPaid === true && sale.isPaid === false) {
  sale.amountReceived = 0;
 } else if (previous) {
  sale.amountReceived = Math.min(total, Number(previous.amountReceived || 0));
 } else {
  sale.amountReceived = 0;
 }
 sale.paymentStatus = derivePaymentStatus(sale.amountReceived, total, sale.isAcquisitionCost);
 sale.isPaid = sale.paymentStatus === "PAID" || sale.paymentStatus === "NOT_APPLICABLE";
 return sale;
}

async function allocateReceivedAmount(items, requestedAmount) {
 const totals = items.map(saleReceivableTotal);
 const total = money(totals.reduce((sum, value) => sum + value, 0));
 const amount = money(Math.max(0, Number(requestedAmount || 0)));
 if (amount > total + 0.009) throw new Error(`Received amount cannot exceed invoice total ₹${total.toFixed(2)}`);
 let allocated = 0;
 for (let index = 0; index < items.length; index += 1) {
  const item = items[index];
  const lineTotal = totals[index];
  const lineAmount = index === items.length - 1
   ? money(amount - allocated)
   : money(total > 0 ? amount * (lineTotal / total) : 0);
  allocated = money(allocated + lineAmount);
  item.amountReceived = Math.min(lineTotal, Math.max(0, lineAmount));
  item.paymentStatus = derivePaymentStatus(item.amountReceived, lineTotal, isAcquisitionSale(item));
  item.isPaid = item.paymentStatus === "PAID" || item.paymentStatus === "NOT_APPLICABLE";
  item.paymentUpdatedAt = new Date();
  await item.save();
 }
 return { total, received: amount, pending: money(total - amount), status: derivePaymentStatus(amount, total) };
}

async function backfillFinanceFields() {
 const cursor = Sale.collection.find({ $or: [
  { paymentStatus: { $exists: false } },
  { amountReceived: { $exists: false } },
  { counterpartyKey: { $exists: false } },
  { isAcquisitionCost: { $exists: false } }
 ] });
 let updated = 0;
 for await (const sale of cursor) {
  const acquisition = Number(sale.soldPrice || 0) === 0;
  const counterpartyType = sale.counterpartyType === "dealer" ? "dealer" : "customer";
  const counterpartyKey = sale.dealerId ? `dealer:${sale.dealerId}` : `${counterpartyType}:${normalizeParty(sale.customerName)}`;
  const total = saleReceivableTotal(sale);
  const amountReceived = acquisition ? 0 : sale.amountReceived === undefined ? (sale.isPaid ? total : 0) : Math.min(total, Number(sale.amountReceived || 0));
  const paymentStatus = derivePaymentStatus(amountReceived, total, acquisition);
  await Sale.collection.updateOne({ _id: sale._id }, { $set: {
   isAcquisitionCost: acquisition || Boolean(sale.isAcquisitionCost),
   acquisitionType: acquisition ? (sale.acquisitionType || "sample") : (sale.acquisitionType || null),
   counterpartyType,
   counterpartyKey,
   amountReceived,
   paymentStatus,
   isPaid: paymentStatus === "PAID" || paymentStatus === "NOT_APPLICABLE"
  } });
  updated += 1;
 }
 if (updated) console.log(`Finance fields backfilled for ${updated} sale records`);
}

/* ================= WEBSITE INTEGRATION ================= */

function integrationAuth(req, res, next) {
 const production = isProduction || process.env.RAILWAY_ENVIRONMENT_NAME;
 const expected = String(process.env.INTEGRATION_API_KEY || (production ? "" : "eeerp-local-development-key-v1"));
 const supplied = String(req.headers["x-integration-key"] || "");
 if (!expected) return res.status(503).json({ success: false, message: "INTEGRATION_API_KEY is not configured in EEERP" });
 const left = Buffer.from(expected);
 const right = Buffer.from(supplied);
 if (left.length !== right.length || !require("crypto").timingSafeEqual(left, right)) {
  return res.status(401).json({ success: false, message: "Invalid integration credentials" });
 }
 next();
}

app.post("/api/integrations/ecommerce/sales", integrationAuth, async (req, res) => {
 try {
  const order = req.body || {};
  const orderId = String(order.orderId || "").trim();
  const items = Array.isArray(order.items) ? order.items : [];
  if (!orderId || !items.length) return res.status(400).json({ success: false, message: "orderId and items are required" });
  const subtotal = Number(order.subtotal || 0);
  const totalDiscount = Number(order.discount || 0);
  const invoiceNumber = String(order.invoiceNumber || orderId);
  const operations = items.map((item, index) => {
   const qty = Math.max(1, Number(item.qty || item.quantity || 1));
   const unitPrice = Number(item.price || 0);
   const lineGross = unitPrice * qty;
   const lineDiscount = subtotal > 0 ? totalDiscount * (lineGross / subtotal) : 0;
   const sizeMatch = String(item.size || item.variantLabel || "").match(/[\d.]+/);
   const soldPrice = Math.max(0, lineGross);
   const paid = ["PAID", "PAYMENT_CAPTURED", "DELIVERED"].includes(String(order.paymentStatus || order.status));
   const lineReceivable = Math.max(0, soldPrice - lineDiscount);
   const externalReference = `website:${orderId}:${String(item.lineId || index)}`;
   return {
    updateOne: {
     filter: { externalReference },
     update: { $set: {
      externalReference,
      externalOrderId: orderId,
      externalSource: "eternal-essence-website",
      externalStatus: String(order.status || "ORDER_PLACED"),
      paymentStatus: String(order.paymentStatus || ""),
      category: String(item.category || item.itemType || "Product"),
      productName: String(item.name || "Website product"),
      size_ml: Number(sizeMatch?.[0] || 0),
      variantLabel: String(item.size || item.variantLabel || ""),
      units: qty,
      customerName: String(order.customer?.name || order.name || ""),
      counterpartyType: "customer",
      counterpartyKey: `customer:${normalizeParty(order.customer?.name || order.name)}`,
      customerPhone: String(order.customer?.phone || order.phone || ""),
      customerEmail: String(order.customer?.email || order.email || ""),
      customerAddress: String(order.customer?.address || order.shippingAddress || ""),
      referenceSource: "Website",
      manufacturingCost: Number(item.manufacturingCost || 0),
      soldPrice,
      discount: lineDiscount,
      profit: soldPrice - lineDiscount - Number(item.manufacturingCost || 0),
      invoiceNumber,
      invoiceDiscount: totalDiscount,
      couponCode: String(order.couponCode || order.offerCode || ""),
      shippingCharge: index === 0 ? Number(order.shipping || 0) : 0,
      orderSubtotal: subtotal,
      orderTotal: Number(order.total || 0),
      isDelivered: ["DELIVERED", "Delivered"].includes(String(order.status)),
      amountReceived: paid ? lineReceivable : 0,
      paymentUpdatedAt: paid ? new Date() : null,
      paymentStatus: paid ? "PAID" : "UNPAID",
      isPaid: paid,
      saleDate: order.createdAt ? new Date(order.createdAt) : new Date(),
      sourcePayload: { productId: item.productId, variantKey: item.variantKey, freeGift: !!item.freeGift }
     } },
     upsert: true
    }
   };
  });
  const result = await Sale.bulkWrite(operations, { ordered: false });
  res.json({
   success: true,
   orderId,
   invoiceNumber,
   created: result.upsertedCount || 0,
   updated: result.modifiedCount || 0,
   records: operations.length
  });
 } catch (error) {
  console.error("Website sale integration failed:", error);
  res.status(500).json({ success: false, message: "Could not synchronize website sale" });
 }
});

/* ================= AUTH ROUTES ================= */

app.post("/api/login", (req,res)=>{
 const { username, password } = req.body;
 if(
 username === process.env.ADMIN_USER &&
 password === process.env.ADMIN_PASS
 ){
  return req.session.regenerate(regenerateError => {
   if (regenerateError) {
    console.error("EEERP login session regeneration failed:", regenerateError);
    return res.status(500).json({success:false, message:"Could not start the admin session."});
   }
   req.session.authenticated = true;
   req.session.save(saveError => {
    if (saveError) {
     console.error("EEERP login session save failed:", saveError);
     return res.status(500).json({success:false, message:"Could not save the admin session."});
    }
    return res.json({success:true});
   });
  });
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

/* ================= DEALERS & COUNTERPARTIES ================= */

app.get("/api/dealers", requireAuth, async (req, res) => {
 res.json(await Dealer.find().sort({ active: -1, name: 1 }));
});

app.post("/api/dealers", requireAuth, async (req, res) => {
 try {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ success: false, message: "Dealer name is required" });
  const dealer = await Dealer.create({ ...req.body, name });
  res.json({ success: true, data: dealer });
 } catch (error) {
  if (error.code === 11000) return res.status(409).json({ success: false, message: "This dealer already exists" });
  res.status(500).json({ success: false, message: "Could not save dealer" });
 }
});

app.put("/api/dealers/:id", requireAuth, async (req, res) => {
 const dealer = await Dealer.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
 if (!dealer) return res.status(404).json({ success: false, message: "Dealer not found" });
 res.json({ success: true, data: dealer });
});

app.delete("/api/dealers/:id", requireAuth, async (req, res) => {
 const used = await Sale.exists({ dealerId: req.params.id });
 if (used) {
  const dealer = await Dealer.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
  return res.json({ success: true, archived: true, data: dealer });
 }
 await Dealer.findByIdAndDelete(req.params.id);
 res.json({ success: true, deleted: true });
});

app.get("/api/customers", requireAuth, async (req, res) => {
 const names = await Sale.distinct("customerName", { customerName: { $nin: [null, ""] } });
 res.json(names.sort((a, b) => a.localeCompare(b)).map(name => ({
  name,
  key: `customer:${normalizeParty(name)}`
 })));
});

/* ================= RECEIVABLES & ACQUISITION ================= */

app.get("/api/receivables", requireAuth, async (req, res) => {
 const query = { counterpartyType: "dealer", isAcquisitionCost: { $ne: true }, soldPrice: { $gt: 0 } };
 if (req.query.dealerId) query.dealerId = req.query.dealerId;
 const sales = await Sale.find(query).sort({ saleDate: -1 });
 const groups = new Map();
 for (const sale of sales) {
  const key = sale.invoiceNumber || `SALE-${sale._id}`;
  if (!groups.has(key)) groups.set(key, {
   reference: key,
   invoiceNumber: sale.invoiceNumber || null,
   dealerId: sale.dealerId || null,
   dealerName: sale.customerName || "Unnamed dealer",
   saleDate: sale.saleDate,
   itemCount: 0,
   total: 0,
   received: 0,
   pending: 0,
   itemIds: []
  });
  const group = groups.get(key);
  group.itemCount += 1;
  group.itemIds.push(sale._id);
  group.total = money(group.total + saleReceivableTotal(sale));
  group.received = money(group.received + Number(sale.amountReceived || 0));
 }
 let rows = [...groups.values()].map(group => ({
  ...group,
  pending: money(Math.max(0, group.total - group.received)),
  paymentStatus: derivePaymentStatus(group.received, group.total)
 }));
 if (req.query.status) rows = rows.filter(row => row.paymentStatus === String(req.query.status).toUpperCase());
 res.json(rows);
});

app.put("/api/invoices/:invoiceNumber/payment", requireAuth, async (req, res) => {
 try {
  const items = await Sale.find({ invoiceNumber: req.params.invoiceNumber });
  if (!items.length) return res.status(404).json({ success: false, message: "Invoice not found" });
  const total = money(items.reduce((sum, item) => sum + saleReceivableTotal(item), 0));
  const requested = String(req.body.paymentStatus || "").toUpperCase();
  const amount = requested === "PAID" ? total : requested === "UNPAID" ? 0 : req.body.amountReceived;
  if (amount === undefined) return res.status(400).json({ success: false, message: "Received amount is required for a partial payment" });
  const finance = await allocateReceivedAmount(items, amount);
  res.json({ success: true, invoiceNumber: req.params.invoiceNumber, ...finance });
 } catch (error) {
  res.status(400).json({ success: false, message: error.message });
 }
});

app.post("/api/sales/bulk-payment", requireAuth, async (req, res) => {
 try {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ success: false, message: "Select at least one product" });
  const items = await Sale.find({ _id: { $in: ids }, isAcquisitionCost: { $ne: true } });
  if (!items.length) return res.status(404).json({ success: false, message: "No payable products found" });
  const total = money(items.reduce((sum, item) => sum + saleReceivableTotal(item), 0));
  const requested = String(req.body.paymentStatus || "").toUpperCase();
  const amount = requested === "PAID" ? total : requested === "UNPAID" ? 0 : req.body.amountReceived;
  if (amount === undefined) return res.status(400).json({ success: false, message: "Enter the total amount received for the selected products" });
  const finance = await allocateReceivedAmount(items, amount);
  res.json({ success: true, updated: items.length, ...finance });
 } catch (error) {
  res.status(400).json({ success: false, message: error.message });
 }
});

app.get("/api/dealer-finances", requireAuth, async (req, res) => {
 const match = { counterpartyType: "dealer" };
 if (req.query.dealerId) match.dealerId = req.query.dealerId;
 const sales = await Sale.find(match);
 const dealers = new Map();
 for (const sale of sales) {
  const key = String(sale.dealerId || sale.counterpartyKey || normalizeParty(sale.customerName));
  if (!dealers.has(key)) dealers.set(key, {
   dealerId: sale.dealerId || null,
   dealerName: sale.customerName || "Unnamed dealer",
   totalSales: 0,
   received: 0,
   acquisitionCost: 0,
   invoices: new Set()
  });
  const row = dealers.get(key);
  if (isAcquisitionSale(sale)) row.acquisitionCost = money(row.acquisitionCost + acquisitionExpense(sale));
  else {
   row.totalSales = money(row.totalSales + saleReceivableTotal(sale));
   row.received = money(row.received + Number(sale.amountReceived || 0));
  }
  if (sale.invoiceNumber) row.invoices.add(sale.invoiceNumber);
 }
 res.json([...dealers.values()].map(row => ({
  ...row,
  invoices: row.invoices.size,
  pending: money(Math.max(0, row.totalSales - row.received)),
  paymentStatus: derivePaymentStatus(row.received, row.totalSales)
 })).sort((a, b) => b.pending - a.pending));
});

app.get("/api/acquisition-analytics", requireAuth, async (req, res) => {
 const sales = await Sale.find().sort({ saleDate: 1 });
 const groups = new Map();
 for (const sale of sales) {
  const type = sale.counterpartyType === "dealer" ? "dealer" : "customer";
  const key = sale.counterpartyKey || (sale.dealerId ? `dealer:${sale.dealerId}` : `${type}:${normalizeParty(sale.customerName)}`);
  if (!key || key.endsWith(":")) continue;
  if (!groups.has(key)) groups.set(key, {
   counterpartyKey: key,
   counterpartyType: type,
   name: sale.customerName || "Unknown",
   acquisitionCost: 0,
   attributedRevenue: 0,
   attributedProfit: 0,
   firstSampleDate: null,
   ordersAfterSample: 0
  });
  const row = groups.get(key);
  if (isAcquisitionSale(sale)) {
   row.acquisitionCost = money(row.acquisitionCost + acquisitionExpense(sale));
   const date = new Date(sale.saleDate);
   if (!row.firstSampleDate || date < row.firstSampleDate) row.firstSampleDate = date;
  } else if (row.firstSampleDate && new Date(sale.saleDate) >= row.firstSampleDate) {
   row.attributedRevenue = money(row.attributedRevenue + saleReceivableTotal(sale));
   row.attributedProfit = money(row.attributedProfit + Number(sale.profit || 0));
   row.ordersAfterSample += 1;
  }
 }
 let rows = [...groups.values()].filter(row => row.acquisitionCost > 0).map(row => ({
  ...row,
  converted: row.ordersAfterSample > 0,
  revenueToCostPercent: row.acquisitionCost ? money(row.attributedRevenue / row.acquisitionCost * 100) : 0,
  netReturnAfterAcquisition: money(row.attributedProfit - row.acquisitionCost)
 }));
 if (req.query.type) rows = rows.filter(row => row.counterpartyType === req.query.type);
 if (req.query.party) rows = rows.filter(row => row.counterpartyKey === req.query.party);
 const acquisitionCost = money(rows.reduce((sum, row) => sum + row.acquisitionCost, 0));
 const converted = rows.filter(row => row.converted).length;
 res.json({
  summary: {
   acquisitionCost,
   sampledParties: rows.length,
   convertedParties: converted,
   conversionRate: rows.length ? money(converted / rows.length * 100) : 0,
   attributedRevenue: money(rows.reduce((sum, row) => sum + row.attributedRevenue, 0)),
   netReturnAfterAcquisition: money(rows.reduce((sum, row) => sum + row.netReturnAfterAcquisition, 0))
  },
  rows
 });
});

/* ================= SALES ================= */

app.post("/api/sales", requireAuth, async(req,res)=>{
 let s={ ...req.body };
 if (s.counterpartyType === "dealer") {
  const dealer = mongoose.isValidObjectId(s.dealerId) ? await Dealer.findById(s.dealerId) : null;
  if (!dealer || dealer.active === false) return res.status(400).json({ success: false, message: "Select an active dealer" });
  s.customerName = dealer.name;
 }
 
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

 prepareSaleAccounting(s);

 const data=await Sale.create(s);
 res.json({success:true,data});
});

app.get("/api/sales", requireAuth, async(req,res)=>{
 res.json(await Sale.find().sort({_id:-1}));
});

// UPDATED: Handle editing a sale and reverting/re-deducting stock
app.put("/api/sales/:id", requireAuth, async(req,res)=>{
 let s={ ...req.body };
 
 const oldSale = await Sale.findById(req.params.id);
 if (!oldSale) return res.status(404).json({success: false, message: "Sale not found"});
 if (s.counterpartyType === "dealer" || (!s.counterpartyType && oldSale.counterpartyType === "dealer")) {
  const dealerId = s.dealerId || oldSale.dealerId;
  const dealer = mongoose.isValidObjectId(dealerId) ? await Dealer.findById(dealerId) : null;
  if (!dealer || dealer.active === false) return res.status(400).json({ success: false, message: "Select an active dealer" });
  s.customerName = dealer.name;
  s.dealerId = dealer._id;
 }

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

 prepareSaleAccounting(s, oldSale);

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
    
    await recalculateInvoiceDiscount(invoiceNumber);
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
    sale.amountReceived = Math.min(Number(sale.amountReceived || 0), saleReceivableTotal(sale));
    sale.paymentStatus = derivePaymentStatus(sale.amountReceived, saleReceivableTotal(sale), isAcquisitionSale(sale));
    sale.isPaid = sale.paymentStatus === "PAID" || sale.paymentStatus === "NOT_APPLICABLE";
    await sale.save();
    
    if(invNum) {
        const remaining = await Sale.findOne({ invoiceNumber: invNum });
        if(remaining) {
            const newRev = (remaining.revisionCount || 0) + 1;
            await Sale.updateMany({ invoiceNumber: invNum }, { $set: { revisionCount: newRev } });
            await recalculateInvoiceDiscount(invNum);
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
  
  await recalculateInvoiceDiscount(req.params.invoiceNumber);
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
        sale.amountReceived = Math.min(Number(sale.amountReceived || 0), saleReceivableTotal(sale));
        sale.paymentStatus = derivePaymentStatus(sale.amountReceived, saleReceivableTotal(sale), isAcquisitionSale(sale));
        sale.isPaid = sale.paymentStatus === "PAID" || sale.paymentStatus === "NOT_APPLICABLE";
        await sale.save();
    }
    
    res.json({ success: true });
});

async function recalculateInvoiceDiscount(invoiceNumber) {
    const items = await Sale.find({ invoiceNumber });
    if(items.length === 0) return;
    const receivedBefore = money(items.reduce((sum, item) => sum + Number(item.amountReceived || 0), 0));
    
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
    const refreshed = await Sale.find({ invoiceNumber });
    const revisedTotal = money(refreshed.reduce((sum, item) => sum + saleReceivableTotal(item), 0));
    await allocateReceivedAmount(refreshed, Math.min(receivedBefore, revisedTotal));
}

/* ================= DASHBOARD ================= */

app.get("/api/dashboard", requireAuth, async(req,res)=>{
 const stock=await Stock.find();
 const sales=await Sale.find();

 const totalInvestment = stock.reduce((a,b)=>a+(b.cost||0),0);
 
 const deadStockCost = stock.filter(s => s.status !== "Active").reduce((a,b)=>a+(b.cost||0), 0);

 const acquisitionSales = sales.filter(isAcquisitionSale);
 const revenueSales = sales.filter(sale => !isAcquisitionSale(sale));
 const totalSales = revenueSales.reduce((a,b)=>a+((b.soldPrice||0) - (b.discount||0) - (b.distributorMargin||0)),0);
 const acquisitionCost = acquisitionSales.reduce((sum, sale) => sum + acquisitionExpense(sale), 0);
 const operatingProfitBeforeAcquisition = revenueSales.reduce((a,b)=>a+(b.profit||0),0) - deadStockCost;
 const totalProfit = operatingProfitBeforeAcquisition - acquisitionCost;
 const receivableTotal = revenueSales.reduce((sum, sale) => sum + saleReceivableTotal(sale), 0);
 const receivedTotal = revenueSales.reduce((sum, sale) => sum + Number(sale.amountReceived || 0), 0);

 res.json({
  totalInvestment,
  totalSales,
  totalProfit,
  operatingProfitBeforeAcquisition,
  acquisitionCost,
  receivableTotal: money(receivableTotal),
  receivedTotal: money(receivedTotal),
  pendingTotal: money(Math.max(0, receivableTotal - receivedTotal)),
  roi: totalInvestment ? totalProfit/totalInvestment : 0
 });
});

if (require.main === module) {
 app.listen(PORT, () => console.log(`EEERP running on http://localhost:${PORT}`));
 connectDatabase();
}

module.exports = {
 app,
 finance: { money, isAcquisitionSale, saleReceivableTotal, acquisitionExpense, derivePaymentStatus, prepareSaleAccounting }
};
